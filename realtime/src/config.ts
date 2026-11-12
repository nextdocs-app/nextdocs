import 'dotenv/config';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_JWT_SECRET = 'dev-jwt-secret';
const DEV_SERVICE_TOKEN = 'dev-yhub-service-token';
const PLACEHOLDER_SECRET = 'CHANGE_ME_IN_PRODUCTION';
const MIN_SECRET_BYTES = 32;

/**
 * Read a shared secret.
 *
 * Development keeps the zero-setup defaults so `./nd dev` works without an env
 * file. Production must never run on a published value: a known JWT secret lets
 * anyone mint tokens, and a known service token grants full admin access to every
 * document through Yhub's permission model. Failing at module load is deliberate —
 * a server that starts with the wrong secret looks healthy while rejecting every
 * connection (or accepting forged ones).
 */
function readSecret(
  name: string,
  raw: string | undefined,
  devDefault: string,
  options?: { preserveWhitespace?: boolean }
): string {
  const rawValue = raw ?? '';
  const trimmed = rawValue.trim();
  // A blank value means "unset" in either mode. Otherwise a signing secret is used
  // byte-for-byte: the API signs with the configured value untrimmed, so trimming
  // here would reject every token whenever the deployment carries surrounding space.
  const value = trimmed
    ? options?.preserveWhitespace
      ? rawValue
      : trimmed
    : IS_PRODUCTION
      ? ''
      : devDefault;

  if (!value) {
    throw new Error(
      `${name} is required: set it to a unique value of at least ${MIN_SECRET_BYTES} bytes.`
    );
  }

  if (IS_PRODUCTION) {
    if (trimmed === devDefault || trimmed === PLACEHOLDER_SECRET) {
      throw new Error(
        `${name} still has a development default; set a unique secret before starting in production.`
      );
    }
    if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
      throw new Error(`${name} must be at least ${MIN_SECRET_BYTES} bytes.`);
    }
  }

  return value;
}

function readPositiveInt(name: string, raw: string | undefined, fallback: number, min = 1): number {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, received "${raw}".`);
  }
  return value;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

/** An unknown level would silently silence everything; fail at startup instead. */
function readLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? 'info').trim().toLowerCase();
  if (!LOG_LEVELS.has(value)) {
    throw new Error(`LOG_LEVEL must be one of debug, info, warn, error; received "${raw}".`);
  }
  return value as LogLevel;
}

export const ORG = 'nextdocs';
export const IS_PRODUCTION_ENV = IS_PRODUCTION;
export const LOG_LEVEL = readLogLevel(process.env.LOG_LEVEL);
// Port 0 is valid: it asks the OS for an ephemeral port (tests use it).
export const PORT = readPositiveInt('PORT', process.env.PORT, 1234, 0);
export const REDIS_URL = process.env.REDIS || 'redis://localhost:6379';
export const POSTGRES_URL =
  process.env.POSTGRES || 'postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub';
export const API_BASE_URL = (process.env.API_BASE_URL || 'http://localhost:8080').replace(
  /\/+$/,
  ''
);
export const JWT_SECRET = readSecret('JWT_SECRET', process.env.JWT_SECRET, DEV_JWT_SECRET, {
  preserveWhitespace: true,
});
export const YHUB_SERVICE_TOKEN = readSecret(
  'YHUB_SERVICE_TOKEN',
  process.env.YHUB_SERVICE_TOKEN,
  DEV_SERVICE_TOKEN
);

export const CORS_ORIGINS = (
  process.env.CORS_ORIGIN ||
  process.env.CORS_ALLOWED_ORIGINS ||
  // Legacy name kept for deployments that predate the split options.
  process.env.CORS_ORIGINS ||
  'http://localhost:3000'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * UTF-8 byte cap for one document's search projection. The API reads the same variable
 * (SEARCH_MAX_CONTENT_BYTES) for its own clamp, so the two services cannot disagree.
 */
export const MAX_TEXT_BYTES = readPositiveInt(
  'SEARCH_MAX_CONTENT_BYTES',
  process.env.SEARCH_MAX_CONTENT_BYTES,
  256 * 1024
);

/** Same ceiling the plan set: far below Yhub's 500 MB default, which is a memory hazard. */
export const MAX_DOC_SIZE_BYTES = readPositiveInt(
  'MAX_DOC_SIZE_BYTES',
  process.env.MAX_DOC_SIZE_BYTES,
  16 * 1024 * 1024
);

/** Re-auth every room with a live socket this often, to catch a missed revocation event. */
export const SWEEP_INTERVAL_MS = readPositiveInt(
  'SWEEP_INTERVAL_MS',
  process.env.SWEEP_INTERVAL_MS,
  30_000
);

/** Upper bound for one batched recheck request, so a subtree move cannot fan out unbounded. */
export const MAX_RECHECK_DOCS = readPositiveInt(
  'MAX_RECHECK_DOCS',
  process.env.MAX_RECHECK_DOCS,
  5000
);

/**
 * Upper bound for one content-reindex batch. Each id costs a Y.Doc read and an
 * extraction, so this is deliberately much smaller than the recheck batch. The API
 * reads the same variable for its own crawl batch, so one setting bounds both sides.
 */
export const MAX_REINDEX_DOCS = readPositiveInt(
  'SEARCH_MAX_REINDEX_DOCS',
  process.env.SEARCH_MAX_REINDEX_DOCS,
  50
);

/**
 * Base URL for the service's own HTTP calls, currently the Y.Doc read behind a search
 * reindex. Defaults to the local listener; override it when Yhub's HTTP channel is reached
 * through a different host, port, or TLS terminator. Trailing slashes are dropped so a
 * configured value composes with a path the same way the default does.
 */
export const INTERNAL_HTTP_URL = (
  process.env.YHUB_INTERNAL_HTTP_URL?.trim() || `http://127.0.0.1:${PORT}`
).replace(/\/+$/, '');

/**
 * Rooms rechecked in parallel by the sweep and the batch endpoint. A sweep over a
 * few hundred rooms must finish inside its 30 s interval even when the API is slow.
 */
export const RECHECK_CONCURRENCY = readPositiveInt(
  'RECHECK_CONCURRENCY',
  process.env.RECHECK_CONCURRENCY,
  8
);

// Canonical lowercase only: Yhub keys rooms by the exact docid string, so accepting
// an uppercase UUID would open a second room for the same document.
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
