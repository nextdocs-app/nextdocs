import 'dotenv/config';
import net from 'net';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const VALID_LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'] as const;

function parseLogLevel(value: string | undefined): LogLevel {
  if (value && VALID_LOG_LEVELS.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return 'info';
}

interface Limits {
  maxPayload: number;
  maxConnsPerIp: number;
  maxGlobalConns: number;
  maxConnRatePerMin: number;
  maxMsgRatePerSec: number;
  memoryThreshold: number; // Percentage of heap used (0-1)
}

interface Config {
  port: number;
  host: string;
  apiBaseUrl: string;
  corsOrigins: string[];
  logLevel: LogLevel;
  trustedProxies: string[];
  roomCleanupInterval: number;
  roomInactiveTimeout: number;
  accessRevalidationIntervalMs: number;
  anonymousAccessRevalidationIntervalMs: number;
  fetchTimeoutMs: number;
  unauthorizedAccessCooldownMs: number;
  unauthorizedAccessWarnIntervalMs: number;
  enforceMemoryThreshold: boolean;
  limits: Limits;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return fallback;
}

const isProd = process.env.NODE_ENV === 'production';

const config: Config = {
  port: parseInt(process.env.PORT || '1234', 10),
  host: process.env.HOST || '0.0.0.0',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:8080',

  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : process.env.NODE_ENV === 'production'
      ? ['http://localhost:3000']
      : [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          // Allow phone/tablet testing over LAN without per-network env edits in development.
          // Private IPv4 ranges (RFC 1918): 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16.
          'http://192.168.*.*:3000',
          'http://10.*.*.*:3000',
          ...Array.from({ length: 16 }, (_, i) => `http://172.${i + 16}.*.*:3000`),
        ],

  logLevel: parseLogLevel(process.env.LOG_LEVEL),

  // Comma-separated list of trusted proxy IPs or IPv4 CIDRs whose X-Forwarded-For
  // header is accepted (e.g. '127.0.0.1,10.0.0.0/8'). IPv6 CIDRs are rejected
  // at startup: matching is IPv4-only, so accepting them would silently ignore
  // the header. Empty by default.
  //
  // X-Forwarded-For is read right to left, skipping these proxies, so list only
  // the proxies in front of this server: a CIDR that also covers real clients
  // would let those clients spoof the per-IP limits.
  trustedProxies: process.env.TRUSTED_PROXIES
    ? process.env.TRUSTED_PROXIES.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [],

  roomCleanupInterval: parseInt(process.env.ROOM_CLEANUP_INTERVAL || '300000', 10),
  roomInactiveTimeout: parseInt(process.env.ROOM_INACTIVE_TIMEOUT || '3600000', 10),
  accessRevalidationIntervalMs: parseInt(process.env.ACCESS_REVALIDATION_INTERVAL_MS || '5000', 10),
  // Anonymous share-link rooms revalidate lazily: link revocation is enforced
  // on every (re)connect, and guests share one API rate-limit budget per IP,
  // so a 5s cadence per room would starve page loads on multi-tab/NAT setups.
  anonymousAccessRevalidationIntervalMs: parseInt(
    process.env.ANONYMOUS_ACCESS_REVALIDATION_INTERVAL_MS || '30000',
    10
  ),
  fetchTimeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || '5000', 10),
  unauthorizedAccessCooldownMs: parseInt(
    process.env.UNAUTHORIZED_ACCESS_COOLDOWN_MS || '15000',
    10
  ),
  unauthorizedAccessWarnIntervalMs: parseInt(
    process.env.UNAUTHORIZED_ACCESS_WARN_INTERVAL_MS || '10000',
    10
  ),
  enforceMemoryThreshold: parseBoolean(process.env.ENFORCE_MEMORY_THRESHOLD, isProd),

  limits: {
    maxPayload: parseInt(process.env.MAX_PAYLOAD || '5242880', 10),
    maxConnsPerIp: parseInt(process.env.MAX_CONNS_PER_IP || '100', 10),
    maxGlobalConns: parseInt(process.env.MAX_GLOBAL_CONNS || '10000', 10),
    maxConnRatePerMin: parseInt(process.env.MAX_CONN_RATE_PER_MIN || '100', 10),
    maxMsgRatePerSec: parseInt(process.env.MAX_MSG_RATE_PER_SEC || '100', 10),
    memoryThreshold: parseFloat(process.env.MEMORY_THRESHOLD || (isProd ? '0.8' : '0.95')),
  },
};

if (Number.isNaN(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}. Must be between 1 and 65535.`);
}

if (Number.isNaN(config.roomCleanupInterval) || config.roomCleanupInterval <= 0) {
  throw new Error(
    `Invalid ROOM_CLEANUP_INTERVAL: ${process.env.ROOM_CLEANUP_INTERVAL}. Must be a positive number (milliseconds).`
  );
}

if (Number.isNaN(config.roomInactiveTimeout) || config.roomInactiveTimeout <= 0) {
  throw new Error(
    `Invalid ROOM_INACTIVE_TIMEOUT: ${process.env.ROOM_INACTIVE_TIMEOUT}. Must be a positive number (milliseconds).`
  );
}

if (Number.isNaN(config.accessRevalidationIntervalMs) || config.accessRevalidationIntervalMs <= 0) {
  throw new Error(
    `Invalid ACCESS_REVALIDATION_INTERVAL_MS: ${process.env.ACCESS_REVALIDATION_INTERVAL_MS}. Must be a positive number (milliseconds).`
  );
}

if (
  Number.isNaN(config.anonymousAccessRevalidationIntervalMs) ||
  config.anonymousAccessRevalidationIntervalMs <= 0
) {
  throw new Error(
    `Invalid ANONYMOUS_ACCESS_REVALIDATION_INTERVAL_MS: ${process.env.ANONYMOUS_ACCESS_REVALIDATION_INTERVAL_MS}. Must be a positive number (milliseconds).`
  );
}

if (Number.isNaN(config.fetchTimeoutMs) || config.fetchTimeoutMs <= 0) {
  throw new Error(
    `Invalid FETCH_TIMEOUT_MS: ${process.env.FETCH_TIMEOUT_MS}. Must be a positive number (milliseconds).`
  );
}

if (Number.isNaN(config.unauthorizedAccessCooldownMs) || config.unauthorizedAccessCooldownMs <= 0) {
  throw new Error(
    `Invalid UNAUTHORIZED_ACCESS_COOLDOWN_MS: ${process.env.UNAUTHORIZED_ACCESS_COOLDOWN_MS}. Must be a positive number (milliseconds).`
  );
}

if (
  Number.isNaN(config.unauthorizedAccessWarnIntervalMs) ||
  config.unauthorizedAccessWarnIntervalMs <= 0
) {
  throw new Error(
    `Invalid UNAUTHORIZED_ACCESS_WARN_INTERVAL_MS: ${process.env.UNAUTHORIZED_ACCESS_WARN_INTERVAL_MS}. Must be a positive number (milliseconds).`
  );
}

if (config.limits.maxPayload <= 0 || Number.isNaN(config.limits.maxPayload)) {
  throw new Error(`Invalid MAX_PAYLOAD: ${process.env.MAX_PAYLOAD}. Must be a positive number.`);
}

if (config.limits.maxConnsPerIp <= 0 || Number.isNaN(config.limits.maxConnsPerIp)) {
  throw new Error(
    `Invalid MAX_CONNS_PER_IP: ${process.env.MAX_CONNS_PER_IP}. Must be a positive number.`
  );
}

if (config.limits.maxGlobalConns <= 0 || Number.isNaN(config.limits.maxGlobalConns)) {
  throw new Error(
    `Invalid MAX_GLOBAL_CONNS: ${process.env.MAX_GLOBAL_CONNS}. Must be a positive number.`
  );
}

if (config.limits.maxConnRatePerMin <= 0 || Number.isNaN(config.limits.maxConnRatePerMin)) {
  throw new Error(
    `Invalid MAX_CONN_RATE_PER_MIN: ${process.env.MAX_CONN_RATE_PER_MIN}. Must be a positive number.`
  );
}

if (config.limits.maxMsgRatePerSec <= 0 || Number.isNaN(config.limits.maxMsgRatePerSec)) {
  throw new Error(
    `Invalid MAX_MSG_RATE_PER_SEC: ${process.env.MAX_MSG_RATE_PER_SEC}. Must be a positive number.`
  );
}

if (
  Number.isNaN(config.limits.memoryThreshold) ||
  config.limits.memoryThreshold <= 0 ||
  config.limits.memoryThreshold > 1
) {
  throw new Error(
    `Invalid MEMORY_THRESHOLD: ${process.env.MEMORY_THRESHOLD}. Must be between 0 and 1.`
  );
}

for (const proxy of config.trustedProxies) {
  const trimmed = proxy.trim();
  if (!trimmed) continue;
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length !== 2) {
      throw new Error(
        `Invalid TRUSTED_PROXIES entry: "${proxy}". Expected IP or CIDR (e.g. 10.0.0.0/8).`
      );
    }
    const [subnet, prefixStr] = parts;
    if (!/^\d+$/.test(prefixStr)) {
      throw new Error(`Invalid TRUSTED_PROXIES entry: "${proxy}". Invalid subnet or prefix.`);
    }
    const prefix = parseInt(prefixStr, 10);
    // Normalize before validation so ::ffff:10.0.0.1/8 is judged the same way
    // isTrustedProxy matches it at runtime (IPv4-mapped IPv6 → IPv4).
    const normalizedSubnet = subnet.toLowerCase().startsWith('::ffff:')
      ? subnet.toLowerCase().slice(7)
      : subnet;
    const ver = net.isIP(normalizedSubnet);
    if (ver === 0 || Number.isNaN(prefix)) {
      throw new Error(`Invalid TRUSTED_PROXIES entry: "${proxy}". Invalid subnet or prefix.`);
    }
    if (ver === 4 && (prefix < 0 || prefix > 32)) {
      throw new Error(`Invalid TRUSTED_PROXIES entry: "${proxy}". IPv4 prefix must be 0-32.`);
    }
    if (ver === 6) {
      // isTrustedProxy only implements IPv4 CIDR matching; accepting an IPv6
      // CIDR would force the X-Forwarded-For header to be ignored silently.
      throw new Error(
        `Invalid TRUSTED_PROXIES entry: "${proxy}". IPv6 CIDR is not supported; use a plain IPv6 address for exact matches.`
      );
    }
  } else {
    if (net.isIP(trimmed) === 0) {
      throw new Error(`Invalid TRUSTED_PROXIES entry: "${proxy}". Must be a valid IP or CIDR.`);
    }
  }
}

export default config;
