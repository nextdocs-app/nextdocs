import { createHash } from 'crypto';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  setupWSConnection,
  updateConnectionAccessLevel,
  type RealtimeAccessLevel,
} from './yjs-utils.js';
import config from './config.js';
import logger from './logger.js';

interface RoomData {
  lastActivity: number;
  connections: number;
}

const rooms = new Map<string, RoomData>();

function getCorsHeaders(req: http.IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };

  if (origin && config.corsOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else if (config.corsOrigins.includes('*')) {
    // Wildcard configured - allow any origin (but no credentials)
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

export const server = http.createServer((req, res) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...corsHeaders,
    });
    res.end(
      JSON.stringify({
        status: 'healthy',
        uptime: process.uptime(),
        rooms: rooms.size,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  if (req.url === '/metrics' && req.method === 'GET') {
    const roomsData = Array.from(rooms.entries()).map(([id, data]) => ({
      id,
      connections: data.connections,
      lastActivity: data.lastActivity,
    }));

    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...corsHeaders,
    });
    res.end(
      JSON.stringify({
        rooms: roomsData,
        totalRooms: rooms.size,
        totalConnections: roomsData.reduce((sum, r) => sum + r.connections, 0),
      })
    );
    return;
  }

  res.writeHead(404, corsHeaders);
  res.end('Not Found');
});

export const wss = new WebSocketServer({
  server,
  // We set a hard limit here, but we also check in application logic for logging/metrics
  maxPayload: config.limits.maxPayload,
});

const ipConnections = new Map<string, number>();
const ipConnectionTimestamps = new Map<string, number[]>();
const unauthorizedAccessCooldown = new Map<string, UnauthorizedCooldownState>();
const unauthorizedCooldownExpirations: UnauthorizedCooldownExpiryEntry[] = [];
const MAX_UNAUTHORIZED_COOLDOWN_EXPIRATIONS_PER_CLEANUP = 512;
const UNAUTHORIZED_COOLDOWN_HEAP_REBUILD_MIN_SIZE = 1024;
const UNAUTHORIZED_COOLDOWN_HEAP_REBUILD_RATIO = 4;
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UnauthorizedCooldownState {
  denyUntil: number;
  lastWarnAt: number;
  suppressedAttempts: number;
}

interface UnauthorizedCooldownExpiryEntry {
  key: string;
  denyUntil: number;
}

interface AccessCheckData {
  allowed: boolean;
  accessLevel: RealtimeAccessLevel | null;
  owner: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

function getClientIp(req: http.IncomingMessage): string {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    // The header can contain a comma-separated list of IPs. The first one is the original client.
    return xForwardedFor.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Prefer Authorization headers to reduce token leakage in logs/proxies.
// Query-string fallback exists because browser WebSocket upgrades cannot set custom auth headers,
// and query tokens may be logged by intermediaries.
function extractToken(req: http.IncomingMessage, url: URL): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }

  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return queryToken;
  }

  return null;
}

function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

function getTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function buildUnauthorizedCooldownKey(roomId: string, clientIp: string, token: string): string {
  return `${roomId}:${clientIp}:${getTokenFingerprint(token)}`;
}

function swapUnauthorizedCooldownHeapEntries(a: number, b: number): void {
  const tmp = unauthorizedCooldownExpirations[a];
  unauthorizedCooldownExpirations[a] = unauthorizedCooldownExpirations[b];
  unauthorizedCooldownExpirations[b] = tmp;
}

function siftUnauthorizedCooldownExpirationUp(index: number): void {
  let current = index;

  while (current > 0) {
    const parent = Math.floor((current - 1) / 2);
    if (
      unauthorizedCooldownExpirations[parent].denyUntil <=
      unauthorizedCooldownExpirations[current].denyUntil
    ) {
      break;
    }

    swapUnauthorizedCooldownHeapEntries(parent, current);
    current = parent;
  }
}

function siftUnauthorizedCooldownExpirationDown(index: number): void {
  let current = index;
  const size = unauthorizedCooldownExpirations.length;

  while (true) {
    const left = current * 2 + 1;
    const right = left + 1;
    let smallest = current;

    if (
      left < size &&
      unauthorizedCooldownExpirations[left].denyUntil <
        unauthorizedCooldownExpirations[smallest].denyUntil
    ) {
      smallest = left;
    }

    if (
      right < size &&
      unauthorizedCooldownExpirations[right].denyUntil <
        unauthorizedCooldownExpirations[smallest].denyUntil
    ) {
      smallest = right;
    }

    if (smallest === current) {
      break;
    }

    swapUnauthorizedCooldownHeapEntries(current, smallest);
    current = smallest;
  }
}

function pushUnauthorizedCooldownExpiration(entry: UnauthorizedCooldownExpiryEntry): void {
  unauthorizedCooldownExpirations.push(entry);
  siftUnauthorizedCooldownExpirationUp(unauthorizedCooldownExpirations.length - 1);
}

function peekUnauthorizedCooldownExpiration(): UnauthorizedCooldownExpiryEntry | null {
  return unauthorizedCooldownExpirations[0] ?? null;
}

function popUnauthorizedCooldownExpiration(): UnauthorizedCooldownExpiryEntry | null {
  if (unauthorizedCooldownExpirations.length === 0) {
    return null;
  }

  const root = unauthorizedCooldownExpirations[0];
  const last = unauthorizedCooldownExpirations.pop();
  if (unauthorizedCooldownExpirations.length > 0 && last) {
    unauthorizedCooldownExpirations[0] = last;
    siftUnauthorizedCooldownExpirationDown(0);
  }

  return root;
}

function rebuildUnauthorizedCooldownExpirationHeap(): void {
  unauthorizedCooldownExpirations.length = 0;

  for (const [key, state] of unauthorizedAccessCooldown.entries()) {
    unauthorizedCooldownExpirations.push({
      key,
      denyUntil: state.denyUntil,
    });
  }

  for (let i = Math.floor(unauthorizedCooldownExpirations.length / 2) - 1; i >= 0; i -= 1) {
    siftUnauthorizedCooldownExpirationDown(i);
  }
}

function maybeRebuildUnauthorizedCooldownExpirationHeap(): void {
  if (unauthorizedCooldownExpirations.length < UNAUTHORIZED_COOLDOWN_HEAP_REBUILD_MIN_SIZE) {
    return;
  }

  if (unauthorizedAccessCooldown.size === 0) {
    unauthorizedCooldownExpirations.length = 0;
    return;
  }

  if (
    unauthorizedCooldownExpirations.length <=
    unauthorizedAccessCooldown.size * UNAUTHORIZED_COOLDOWN_HEAP_REBUILD_RATIO
  ) {
    return;
  }

  rebuildUnauthorizedCooldownExpirationHeap();
}

function getUnauthorizedCooldownState(key: string, now: number): UnauthorizedCooldownState | null {
  const existingState = unauthorizedAccessCooldown.get(key);
  if (!existingState) {
    return null;
  }

  if (existingState.denyUntil <= now) {
    unauthorizedAccessCooldown.delete(key);
    return null;
  }

  return existingState;
}

function trackUnauthorizedAccess(key: string, now: number): UnauthorizedCooldownState {
  const existingState = getUnauthorizedCooldownState(key, now);
  if (existingState) {
    existingState.denyUntil = now + config.unauthorizedAccessCooldownMs;
    pushUnauthorizedCooldownExpiration({ key, denyUntil: existingState.denyUntil });
    return existingState;
  }

  const nextState: UnauthorizedCooldownState = {
    denyUntil: now + config.unauthorizedAccessCooldownMs,
    lastWarnAt: 0,
    suppressedAttempts: 0,
  };

  unauthorizedAccessCooldown.set(key, nextState);
  pushUnauthorizedCooldownExpiration({ key, denyUntil: nextState.denyUntil });
  return nextState;
}

function logUnauthorizedRejection(
  state: UnauthorizedCooldownState,
  context: {
    roomId: string;
    clientIp: string;
    now: number;
    source: 'cooldown' | 'access-check';
  }
): void {
  const cooldownMsRemaining = Math.max(0, state.denyUntil - context.now);
  const shouldWarn = context.now - state.lastWarnAt >= config.unauthorizedAccessWarnIntervalMs;

  if (!shouldWarn) {
    state.suppressedAttempts += 1;
    logger.debug('Connection rejected: unauthorized document access (suppressed)', {
      roomId: context.roomId,
      ip: context.clientIp,
      source: context.source,
      cooldownMsRemaining,
    });
    return;
  }

  logger.warn('Connection rejected: unauthorized document access', {
    roomId: context.roomId,
    ip: context.clientIp,
    source: context.source,
    cooldownMsRemaining,
    suppressedAttempts: state.suppressedAttempts,
  });

  state.lastWarnAt = context.now;
  state.suppressedAttempts = 0;
}

function cleanupExpiredUnauthorizedCooldown(now = Date.now()): void {
  let processedEntries = 0;

  while (processedEntries < MAX_UNAUTHORIZED_COOLDOWN_EXPIRATIONS_PER_CLEANUP) {
    const nextExpiration = peekUnauthorizedCooldownExpiration();
    if (!nextExpiration || nextExpiration.denyUntil > now) {
      break;
    }

    const expiredEntry = popUnauthorizedCooldownExpiration();
    if (!expiredEntry) {
      break;
    }

    processedEntries += 1;

    const existingState = unauthorizedAccessCooldown.get(expiredEntry.key);
    if (!existingState) {
      continue;
    }

    // The key may have been renewed after this heap entry was pushed.
    if (existingState.denyUntil !== expiredEntry.denyUntil) {
      continue;
    }

    unauthorizedAccessCooldown.delete(expiredEntry.key);
  }

  if (unauthorizedAccessCooldown.size === 0) {
    unauthorizedCooldownExpirations.length = 0;
    return;
  }

  maybeRebuildUnauthorizedCooldownExpirationHeap();
}

async function fetchAccess(token: string, roomId: string): Promise<AccessCheckData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.fetchTimeoutMs);

  try {
    const res = await fetch(
      `${config.apiBaseUrl}/api/v1/documents/${encodeURIComponent(roomId)}/access-check`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return null;
    }

    const body = (await res.json()) as ApiEnvelope<AccessCheckData>;
    if (!body.success || !body.data) {
      return null;
    }

    return body.data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.debug('Document access check timed out', {
        roomId,
        error: error.message,
      });
      return null;
    }

    logger.debug('Document access check failed', {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

wss.on('connection', async (conn: WebSocket, req: http.IncomingMessage) => {
  const clientIp = getClientIp(req);
  let revalidateAccessInterval: NodeJS.Timeout | undefined;

  try {
    const currentGlobalConns = wss.clients.size;
    if (currentGlobalConns > config.limits.maxGlobalConns) {
      logger.warn('Connection rejected: Global connection limit reached', {
        ip: clientIp,
        current: currentGlobalConns,
        max: config.limits.maxGlobalConns,
      });
      conn.close(1008, 'Server busy');
      return;
    }

    const memoryUsage = process.memoryUsage();
    const heapUsedRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;
    if (heapUsedRatio > config.limits.memoryThreshold) {
      const payload = {
        ip: clientIp,
        heapUsedRatio,
        threshold: config.limits.memoryThreshold,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        enforce: config.enforceMemoryThreshold,
      };

      if (config.enforceMemoryThreshold) {
        logger.warn('Connection rejected: Memory threshold exceeded', payload);
        conn.close(1008, 'Server busy');
        return;
      }

      logger.warn('Memory threshold exceeded, continuing in warn-only mode', payload);
    }

    const currentIpConns = ipConnections.get(clientIp) || 0;
    if (currentIpConns >= config.limits.maxConnsPerIp) {
      logger.warn('Connection rejected: IP connection limit reached', {
        ip: clientIp,
        current: currentIpConns,
        max: config.limits.maxConnsPerIp,
      });
      conn.close(1008, 'Too many connections');
      return;
    }

    const now = Date.now();
    const timestamps = ipConnectionTimestamps.get(clientIp) || [];

    const windowStart = now - 60000;
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    // Clean up empty IP entries to prevent memory leak
    if (timestamps.length === 0) {
      ipConnectionTimestamps.delete(clientIp);
    }

    if (timestamps.length >= config.limits.maxConnRatePerMin) {
      logger.warn('Connection rejected: IP connection rate limit exceeded', {
        ip: clientIp,
        rate: timestamps.length,
        max: config.limits.maxConnRatePerMin,
      });
      conn.close(1008, 'Rate limit exceeded');
      return;
    }

    timestamps.push(now);
    if (!ipConnectionTimestamps.has(clientIp)) {
      ipConnectionTimestamps.set(clientIp, timestamps);
    }

    let roomId: string;
    let parsedUrl: URL;
    try {
      const rawUrl = req.url ?? '/';
      const baseUrl = `http://${req.headers.host ?? 'localhost'}`;
      parsedUrl = new URL(rawUrl, baseUrl);
      roomId = parsedUrl.pathname.slice(1);
    } catch (err) {
      logger.warn('Connection rejected: failed to parse URL', {
        ip: clientIp,
        url: req.url,
        error: (err as Error).message,
      });
      conn.close(1008, 'Invalid request URL');

      return;
    }

    if (!roomId) {
      logger.warn('Connection rejected: missing room ID', {
        ip: clientIp,
        url: req.url,
      });
      conn.close(1008, 'Room ID required');

      return;
    }

    if (!isValidRoomId(roomId)) {
      logger.info('Connection rejected: invalid room ID format', {
        roomId,
        ip: clientIp,
      });
      conn.close(1008, 'Invalid room ID');
      return;
    }

    const token = extractToken(req, parsedUrl);
    if (!token) {
      logger.warn('Connection rejected: missing access token', { roomId, ip: clientIp });
      conn.close(1008, 'Authentication required');
      return;
    }

    const authCheckNow = Date.now();
    const unauthorizedCooldownKey = buildUnauthorizedCooldownKey(roomId, clientIp, token);
    const activeUnauthorizedCooldownState = getUnauthorizedCooldownState(
      unauthorizedCooldownKey,
      authCheckNow
    );

    if (activeUnauthorizedCooldownState) {
      logUnauthorizedRejection(activeUnauthorizedCooldownState, {
        roomId,
        clientIp,
        now: authCheckNow,
        source: 'cooldown',
      });
      conn.close(1008, 'Access denied');
      return;
    }

    const access = await fetchAccess(token, roomId);
    if (!access?.allowed || !access.accessLevel) {
      const unauthorizedState = trackUnauthorizedAccess(unauthorizedCooldownKey, authCheckNow);
      logUnauthorizedRejection(unauthorizedState, {
        roomId,
        clientIp,
        now: authCheckNow,
        source: 'access-check',
      });
      conn.close(1008, 'Access denied');
      return;
    }

    unauthorizedAccessCooldown.delete(unauthorizedCooldownKey);

    ipConnections.set(clientIp, currentIpConns + 1);

    logger.info('Client connected', { roomId, ip: clientIp });

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        lastActivity: Date.now(),
        connections: 0,
      });
      logger.info('Room created', { roomId });
    }

    const room = rooms.get(roomId)!;
    room.connections += 1;
    room.lastActivity = Date.now();

    try {
      setupWSConnection(conn, roomId, access.accessLevel);
    } catch (error) {
      logger.error('Error setting up Yjs connection', {
        roomId,
        error: (error as Error).message,
      });
      room.connections -= 1;
      if (room.connections <= 0) {
        logger.info('Room empty after setup failure, marking for cleanup', {
          roomId,
        });
        room.lastActivity = Date.now();
      }
      conn.close(1011, 'Internal server error'); // 1011: Internal Error
      return;
    }

    let isRevalidating = false;
    revalidateAccessInterval = setInterval(async () => {
      if (conn.readyState !== WebSocket.OPEN || isRevalidating) {
        return;
      }

      isRevalidating = true;
      try {
        const latestAccess = await fetchAccess(token, roomId);
        if (!latestAccess?.allowed || !latestAccess.accessLevel) {
          logger.info('Connection closed after access revalidation failure', {
            roomId,
            ip: clientIp,
          });
          conn.close(1008, 'Access revoked');
          return;
        }

        updateConnectionAccessLevel(conn, roomId, latestAccess.accessLevel);
      } finally {
        isRevalidating = false;
      }
    }, config.accessRevalidationIntervalMs);
    revalidateAccessInterval.unref();

    let messageCount = 0;
    let lastMessageReset = Date.now();

    conn.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const now = Date.now();

      if (now - lastMessageReset > 1000) {
        messageCount = 0;
        lastMessageReset = now;
      }

      messageCount++;
      if (messageCount > config.limits.maxMsgRatePerSec) {
        logger.warn('Client disconnected: Message rate limit exceeded', {
          ip: clientIp,
          roomId,
          rate: messageCount,
        });
        conn.close(1008, 'Message rate limit exceeded');
        return;
      }

      // We rely on ws configuration for the hard payload limit (maxPayload),
      // but double-check here to allow for potentially finer application control in the future
      // and better logging context.
      let size = 0;
      if (Buffer.isBuffer(data)) {
        size = data.length;
      } else if (data instanceof ArrayBuffer) {
        size = data.byteLength;
      } else if (Array.isArray(data)) {
        size = data.reduce((acc, buf) => acc + buf.length, 0);
      }

      if (size > config.limits.maxPayload) {
        logger.warn('Client disconnected: Max payload size exceeded', {
          ip: clientIp,
          size,
          max: config.limits.maxPayload,
        });
        conn.close(1009, 'Payload too large');
        return;
      }
    });

    conn.on('close', () => {
      if (revalidateAccessInterval) {
        clearInterval(revalidateAccessInterval);
        revalidateAccessInterval = undefined;
      }

      logger.info('Client disconnected', { roomId, ip: clientIp });

      const current = ipConnections.get(clientIp);
      if (current && current > 0) {
        ipConnections.set(clientIp, current - 1);
      }
      // We don't clear timestamps immediately to enforce rate limit even after disconnection

      if (rooms.has(roomId)) {
        room.connections -= 1;

        if (room.connections <= 0) {
          logger.info('Room empty, marking for cleanup', { roomId });
          room.lastActivity = Date.now();
        }
      }
    });

    conn.on('error', (error: Error) => {
      if (revalidateAccessInterval) {
        clearInterval(revalidateAccessInterval);
        revalidateAccessInterval = undefined;
      }
      logger.error('WebSocket error', { roomId, error: error.message });
    });
  } catch (err) {
    if (revalidateAccessInterval) {
      clearInterval(revalidateAccessInterval);
      revalidateAccessInterval = undefined;
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Unexpected error in connection handler', {
      ip: clientIp,
      error: errorMessage,
    });

    if (conn.readyState === WebSocket.OPEN || conn.readyState === WebSocket.CONNECTING) {
      conn.close(1011, 'Internal server error');
    } else {
      conn.terminate();
    }
  }
});

export function cleanupInactiveRooms(): void {
  const now = Date.now();
  let cleaned = 0;

  cleanupExpiredUnauthorizedCooldown(now);

  for (const [roomId, room] of rooms.entries()) {
    const inactive = now - room.lastActivity > config.roomInactiveTimeout;

    if (room.connections === 0 && inactive) {
      rooms.delete(roomId);
      cleaned++;
      logger.info('Room cleaned up', {
        roomId,
        inactiveMs: now - room.lastActivity,
      });
    }
  }

  if (cleaned > 0) {
    logger.info('Cleanup completed', {
      roomsCleaned: cleaned,
      activeRooms: rooms.size,
    });
  }
}
