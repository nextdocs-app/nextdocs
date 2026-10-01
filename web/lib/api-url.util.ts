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

export function buildApiBaseUrl(
  host: { hostname: string; protocol: string } | null,
  configured?: string
): string {
  if (configured && configured.trim()) {
    return stripTrailingSlash(configured.trim());
  }
  if (host?.hostname) {
    const protocol = host.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${formatHostname(host.hostname)}:8080`;
  }
  return 'http://localhost:8080';
}

export function buildRealtimeUrl(
  host: { hostname: string; protocol: string } | null,
  configured?: string
): string {
  if (configured && configured.trim()) {
    return stripTrailingSlash(configured.trim());
  }
  if (host?.hostname) {
    const wsProtocol = host.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${formatHostname(host.hostname)}:1234`;
  }
  return 'ws://localhost:1234';
}

export function getApiBaseUrl(): string {
  return buildApiBaseUrl(currentHost(), process.env.NEXT_PUBLIC_API_URL);
}

export function getRealtimeUrl(): string {
  return buildRealtimeUrl(currentHost(), process.env.NEXT_PUBLIC_REALTIME_URL);
}
