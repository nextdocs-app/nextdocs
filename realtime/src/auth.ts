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
 * Verify a NextDocs access token.
 *
 * This is the server's only identity check, so it pins the algorithm (a token that
 * asks for another one is not ours), requires the expiry the API always sets, and
 * compares the signature in constant time.
 */
export function verifyHs256Jwt(token: string, secret: string): { sub: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256') {
      return null;
    }
  } catch {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
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
  accessLevel: string;
  trashed: boolean;
  allowed: boolean;
}

/**
 * Resolve effective access through the API's internal endpoint.
 *
 * A definitive denial (401/403/404) is `null`; anything else is transient and is
 * surfaced as a 503 so Yhub retries instead of closing a healthy socket with a
 * permanent code. 429 belongs to the transient bucket: the internal endpoint is
 * exempt from the public budget, but an operator's proxy may still throttle it.
 */
export async function checkApiAccess(docid: string, token?: string): Promise<AccessVerdict | null> {
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
    const json = (await res.json()) as { data?: AccessVerdict };
    return json?.data ?? null;
  } catch {
    throw apiError(503, 'Auth backend returned an invalid response');
  }
}
