import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import {
  DIST_MAIN,
  JWT_SECRET,
  POSTGRES_URL,
  REALTIME_DIR,
  REDIS_URL,
  SERVICE_TOKEN,
} from './env.js';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

/** Polls `check` until it returns true; throws with `message` on timeout. */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  message = 'condition not met'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await sleep(50);
  }
}

export function mintToken(sub: string = randomUUID()): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export interface AccessVerdict {
  allowed: boolean;
  trashed?: boolean;
  accessLevel?: string;
}

export interface FakeApi {
  url: string;
  setVerdict(token: string, verdict: AccessVerdict): void;
  setAnonymousVerdict(docid: string, verdict: AccessVerdict): void;
  reset(): void;
  close(): Promise<void>;
}

/**
 * Stands in for the API's internal access endpoint. The realtime service's whole job is
 * to enforce the verdict it is given, so the test controls verdicts directly and the
 * real API (Spring, Postgres) stays out of the loop.
 */
export async function startFakeApi(): Promise<FakeApi> {
  const byToken = new Map<string, AccessVerdict>();
  const byAnonymous = new Map<string, AccessVerdict>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/api/v1/internal/realtime/access') {
      const docid = url.searchParams.get('documentId') ?? '';
      const authorization = req.headers.authorization;
      const token = authorization?.replace(/^Bearer\s+/i, '') ?? null;
      const verdict = token ? byToken.get(token) : byAnonymous.get(docid);
      json(200, {
        success: true,
        data: {
          allowed: verdict?.allowed ?? false,
          trashed: verdict?.trashed ?? false,
          accessLevel: verdict?.accessLevel,
        },
      });
      return;
    }

    if (url.pathname === '/api/v1/internal/realtime/content-updated') {
      json(200, { success: true, data: null });
      return;
    }

    json(404, { success: false, error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    setVerdict: (token, verdict) => byToken.set(token, verdict),
    setAnonymousVerdict: (docid, verdict) => byAnonymous.set(docid, verdict),
    reset: () => {
      byToken.clear();
      byAnonymous.clear();
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

export interface RealtimeProcess {
  base: string;
  wsBase: string;
  child: ChildProcess;
  output(): string;
  stop(): Promise<void>;
}

async function waitForHttp(url: string, timeoutMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(`realtime did not answer ${url} in ${timeoutMs}ms:\n${output()}`);
    }
    await sleep(100);
  }
}

export async function startRealtime(
  options: {
    apiUrl?: string;
    port?: number;
    extraEnv?: Record<string, string>;
    /** Port-in-use tests expect the process to die instead of answering. */
    waitForReady?: boolean;
  } = {}
): Promise<RealtimeProcess> {
  const port = options.port ?? (await freePort());
  const child = spawn(process.execPath, [DIST_MAIN], {
    cwd: REALTIME_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      POSTGRES: POSTGRES_URL,
      REDIS: REDIS_URL,
      JWT_SECRET,
      YHUB_SERVICE_TOKEN: SERVICE_TOKEN,
      API_BASE_URL: options.apiUrl ?? 'http://127.0.0.1:9',
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
      // The sweep is a background safety net; these tests drive rechecks explicitly.
      SWEEP_INTERVAL_MS: '600000',
      ...options.extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });

  const base = `http://127.0.0.1:${port}`;
  if (options.waitForReady !== false) {
    await waitForHttp(`${base}/api/ping/v1`, 30_000, () => output);
  }

  return {
    base,
    wsBase: `ws://127.0.0.1:${port}/api/ws/v1/nextdocs`,
    child,
    output: () => output,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await waitForExit(child, 5000).catch(() => undefined);
      }
    },
  };
}

export function waitForExit(
  child: ChildProcess,
  timeoutMs = 10_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

export interface Client {
  doc: Y.Doc;
  provider: WebsocketProvider;
  destroy(): void;
}

/**
 * A socket that authenticates with headers. Browsers cannot set them, which is exactly why
 * the service identity is only accepted there — tests act as the API does.
 */
function headerSocket(headers: Record<string, string>): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  } as unknown as typeof WebSocket;
}

/** Every provider in this process would otherwise sync over BroadcastChannel, bypassing the server. */
const clients = new Set<Client>();

export function connectClient(
  wsBase: string,
  docid: string,
  options: { token?: string; headers?: Record<string, string>; doc?: Y.Doc } = {}
): Client {
  const doc = options.doc ?? new Y.Doc();
  const provider = new WebsocketProvider(wsBase, docid, doc, {
    params: options.token ? { token: options.token } : {},
    disableBc: true,
    ...(options.headers ? { WebSocketPolyfill: headerSocket(options.headers) } : {}),
  });
  const client: Client = {
    doc,
    provider,
    destroy: () => {
      provider.destroy();
      // y-websocket leaves the Awareness resync interval running; without this the
      // suite finishes green but Jest never exits.
      provider.awareness.destroy();
      clients.delete(client);
    },
  };
  clients.add(client);
  return client;
}

/** Closes every client so a failed assertion cannot leave a socket or timer behind. */
export function destroyClients(): void {
  for (const client of clients) {
    client.destroy();
  }
}

export async function waitForSynced(
  provider: WebsocketProvider,
  timeoutMs = 10_000
): Promise<void> {
  await waitFor(
    () => provider.synced,
    timeoutMs,
    'the client never completed a Yjs sync with the realtime server'
  );
}

export interface CloseDetails {
  code: number;
  reason: string;
}

export function waitForClose(
  provider: WebsocketProvider,
  timeoutMs = 10_000
): Promise<CloseDetails> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the socket was not closed in time')),
      timeoutMs
    );
    provider.on('connection-close', (event) => {
      if (event == null) {
        return;
      }
      clearTimeout(timer);
      resolve({ code: event.code, reason: event.reason });
    });
  });
}

/** Reads the stored document as the service identity, over a socket. */
export async function readTextAsService(
  wsBase: string,
  docid: string,
  textName = 'body'
): Promise<string> {
  const client = connectClient(wsBase, docid, {
    headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
  });
  try {
    await waitForSynced(client.provider);
    return client.doc.getText(textName).toString();
  } finally {
    client.destroy();
  }
}

/** A fresh document id, so tests never share a Yhub room. */
export const newDocId = (): string => randomUUID();
