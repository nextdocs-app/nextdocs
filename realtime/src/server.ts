import { createHash } from 'crypto';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  setupWSConnection,
  updateConnectionAccessLevel,
  type RealtimeAccessLevel,
} from './yjs-utils';
import config from './config';
import logger from './logger';

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
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UnauthorizedCooldownState {
  denyUntil: number;
  lastWarnAt: number;
  suppressedAttempts: number;
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
    return existingState;
  }

  const nextState: UnauthorizedCooldownState = {
    denyUntil: now + config.unauthorizedAccessCooldownMs,
    lastWarnAt: 0,
    suppressedAttempts: 0,
  };

  unauthorizedAccessCooldown.set(key, nextState);
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
  for (const [key, state] of unauthorizedAccessCooldown.entries()) {
    if (state.denyUntil <= now) {
      unauthorizedAccessCooldown.delete(key);
    }
  }
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

// Only start the server if this file is run directly
if (require.main === module) {
  const cleanupInterval = setInterval(cleanupInactiveRooms, config.roomCleanupInterval);

  function shutdown(signal: string): void {
    logger.info('Shutdown signal received', { signal });

    clearInterval(cleanupInterval);

    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });

    server.close(() => {
      logger.info('Server closed successfully');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error('Unhandled rejection', { reason, promise });
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info('NextDocs Realtime Server started', {
      host: config.host,
      port: config.port,
      corsOrigins: config.corsOrigins,
      nodeVersion: process.version,
    });
    logger.info('Health check available at /health');
    logger.info('Metrics available at /metrics');
  });
}
