import crypto from 'crypto';
import { apiError } from '@y/hub';
import { API_BASE_URL, YHUB_SERVICE_TOKEN } from './config.js';

export interface UserAuthInfo {
  userid: string;
  token?: string;
  isService?: boolean;
}

/** Constant-time string comparison that also hides length mismatches. */
export function secretsMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidateBytes, expectedBytes);
}

/**
 * The HMAC algorithms the API can sign with. jjwt picks the strongest one its key
 * supports (a 32-byte secret signs HS256, a longer one HS384/HS512), so all three
 * are ours; anything else - `none` included - is not. A Map keeps the lookup off
 * the prototype chain, so `alg: "constructor"` cannot match.
 */
const HMAC_DIGESTS: ReadonlyMap<string, string> = new Map([
  ['HS256', 'sha256'],
  ['HS384', 'sha384'],
  ['HS512', 'sha512'],
]);

/**
 * Verify a NextDocs access token.
 *
 * This is the server's only identity check, so it pins the algorithm allowlist (a
 * token that asks for another one is not ours), requires the expiry the API always
 * sets, and compares the signature in constant time using the digest that matches
 * the token's declared algorithm.
 */
export function verifyAccessToken(token: string, secret: string): { sub: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let digest: string;
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const alg = header?.alg;
    if (typeof alg !== 'string') {
      return null;
    }
    const match = HMAC_DIGESTS.get(alg);
    if (!match) {
      return null;
    }
    digest = match;
  } catch {
    return null;
  }

  const expectedSig = crypto
    .createHmac(digest, secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actualSig = Buffer.from(sigB64, 'base64url');
  if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload?.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }
    if (typeof payload.exp !== 'number' || Date.now() >= payload.exp * 1000) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * A service identity is only accepted from the Authorization header. The
 * websocket query string is attacker-controlled (it is a URL), so treating a
 * query token as the service credential would turn a leaked token into a
 * browser-reachable admin session.
 */
export function isServiceAuthorization(authHeader: string | undefined): boolean {
  if (!authHeader) {
    return false;
  }
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  return token.length > 0 && secretsMatch(token, YHUB_SERVICE_TOKEN);
}

export interface AccessVerdict {
  accessLevel: string | null;
  trashed: boolean;
  allowed: boolean;
}

/**
 * A 200 is not a verdict by itself: a proxy error page or a changed envelope must
 * not read as "denied" (which closes a healthy socket) or as "allowed". The API
 * omits null fields, so only the boolean fields are required.
 */
function isAccessVerdict(value: unknown): value is AccessVerdict {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const verdict = value as Partial<AccessVerdict>;
  return (
    typeof verdict.allowed === 'boolean' &&
    typeof verdict.trashed === 'boolean' &&
    (verdict.accessLevel === undefined ||
      verdict.accessLevel === null ||
      typeof verdict.accessLevel === 'string')
  );
}

/**
 * Resolve effective access through the API's internal endpoint.
 *
 * A definitive denial (401/403/404) is `null`; anything else is transient and is
 * surfaced as a 503 so Yhub retries instead of closing a healthy socket with a
 * permanent code. 429 belongs to the transient bucket: the internal endpoint is
 * exempt from the public budget, but an operator's proxy may still throttle it.
 */
export async function checkApiAccess(
  docid: string,
  token?: string | null
): Promise<AccessVerdict | null> {
  const url = `${API_BASE_URL}/api/v1/internal/realtime/access?documentId=${encodeURIComponent(docid)}`;
  const headers: Record<string, string> = {
    'X-Yhub-Service': YHUB_SERVICE_TOKEN,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
  } catch {
    throw apiError(503, 'Auth backend unreachable');
  }

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw apiError(503, `Auth backend error (${res.status})`);
  }

  try {
    const json = (await res.json()) as { success?: unknown; data?: unknown };
    if (json?.success !== true || !isAccessVerdict(json.data)) {
      throw apiError(503, 'Auth backend returned an invalid response');
    }
    return json.data;
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    throw apiError(503, 'Auth backend returned an invalid response');
  }
}
