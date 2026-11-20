/**
 * Yhub's REST API shares the realtime server's origin and any path prefix in front
 * of it (a TLS terminator or reverse proxy may mount it under `/realtime`). Keep
 * that prefix and append Yhub's own `/api`, the same way the anchor service does,
 * instead of guessing the page's host.
 */
export function buildYHubApiBaseUrl(realtimeUrl: string): string {
  const url = new URL(realtimeUrl);
  // Only translate the websocket schemes; an already-HTTP base URL keeps its
  // protocol (and its implied default port).
  if (url.protocol === 'ws:') {
    url.protocol = 'http:';
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:';
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/** The only organisation this deployment's realtime server serves. */
export const YHUB_ORG = 'nextdocs';
