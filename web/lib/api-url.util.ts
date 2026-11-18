function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function currentHost(): { hostname: string; protocol: string } | null {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return {
      hostname: window.location.hostname,
      protocol: window.location.protocol,
    };
  }
  return null;
}

function formatHostname(hostname: string): string {
  if (hostname.includes(':') && !hostname.startsWith('[')) {
    return `[${hostname}]`;
  }
  return hostname;
}

/**
 * Port from a NEXT_PUBLIC_* override, or the historical default. The port is separate
 * from the URL override so LAN/phone testing keeps deriving the *host* from the page
 * while a worktree still reaches its own API and realtime servers.
 */
function configuredPort(value: string | undefined, fallback: number): number {
  const port = Number((value || '').trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

export function buildApiBaseUrl(
  host: { hostname: string; protocol: string } | null,
  configured?: string,
  port = 8080
): string {
  if (configured && configured.trim()) {
    return stripTrailingSlash(configured.trim());
  }
  if (host?.hostname) {
    const protocol = host.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${formatHostname(host.hostname)}:${port}`;
  }
  return `http://localhost:${port}`;
}

export function buildRealtimeUrl(
  host: { hostname: string; protocol: string } | null,
  configured?: string,
  port = 1234
): string {
  if (configured && configured.trim()) {
    return stripTrailingSlash(configured.trim());
  }
  if (host?.hostname) {
    const wsProtocol = host.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${formatHostname(host.hostname)}:${port}`;
  }
  return `ws://localhost:${port}`;
}

export function getApiBaseUrl(): string {
  return buildApiBaseUrl(
    currentHost(),
    process.env.NEXT_PUBLIC_API_URL,
    configuredPort(process.env.NEXT_PUBLIC_API_PORT, 8080)
  );
}

export function getRealtimeUrl(): string {
  return buildRealtimeUrl(
    currentHost(),
    process.env.NEXT_PUBLIC_REALTIME_URL,
    configuredPort(process.env.NEXT_PUBLIC_REALTIME_PORT, 1234)
  );
}
