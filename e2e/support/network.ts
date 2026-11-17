import type { Page, Route, WebSocketRoute } from '@playwright/test';
import { API_URL, REALTIME_URL } from './config';

const WS_URL = REALTIME_URL.replace(/^http/, 'ws');
const isRealtimeSocket = (url: URL) => url.href.startsWith(WS_URL);

export interface RealtimeBlock {
  /** Sockets the app opened while the outage was active. */
  connections: () => number;
}

export interface RealtimeTap {
  /** Sockets the app has opened since the tap was installed. */
  connections: () => number;
  /**
   * Terminates the live connection while the page stays open and online, the
   * way a dropped server or proxy would. No reload and no offline emulation.
   */
  kill: () => Promise<void>;
}

/**
 * Simulates the realtime server being unreachable for one page: every WebSocket
 * handshake is intercepted and closed, while the API and Next assets stay up.
 * This is the "open a document during a realtime outage" case.
 *
 * `connections()` is the guard that the outage was really applied — a test that
 * expects the API fallback asserts it, so an inert block cannot pass silently.
 */
export async function blockRealtime(page: Page): Promise<RealtimeBlock> {
  let connections = 0;
  await page.routeWebSocket(isRealtimeSocket, (ws) => {
    connections += 1;
    ws.close({ code: 1011, reason: 'E2E realtime outage' });
  });

  return { connections: () => connections };
}

/**
 * Proxies the page's realtime sockets so a test can kill the live one from
 * under an open editor. Playwright forwards messages automatically because no
 * `onMessage` handler is installed; the 1011 close is abnormal, so recovery has
 * to go through the client's reconnect path rather than a clean shutdown.
 */
export async function tapRealtime(page: Page): Promise<RealtimeTap> {
  const sockets: WebSocketRoute[] = [];
  let connections = 0;
  await page.routeWebSocket(isRealtimeSocket, (ws) => {
    connections += 1;
    // Keep the page-side route: closing it delivers a close event to the
    // client's WebSocket, while closing only the server side is silent there.
    ws.connectToServer();
    sockets.push(ws);
  });

  return {
    connections: () => connections,
    kill: async () => {
      const socket = sockets[sockets.length - 1];
      if (!socket) {
        throw new Error('No realtime socket is open to kill');
      }
      await socket.close({ code: 1011, reason: 'E2E hard socket kill' });
    },
  };
}

/**
 * Answers the document-content read with a transient 503, the case the client
 * is supposed to survive by painting its IndexedDB copy instead of empty state.
 */
export async function failContentRead(page: Page): Promise<() => Promise<void>> {
  const pattern = `**${API_URL}/api/v1/documents/*/content*`;
  const handler = (route: Route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: 'SERVICE_UNAVAILABLE',
        message: 'realtime unavailable',
      }),
    });
  await page.route(pattern, handler);
  return async () => {
    await page.unroute(pattern, handler).catch(() => undefined);
  };
}
