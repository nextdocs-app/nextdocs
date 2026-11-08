import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import crypto from 'crypto';
import {
  verifyAccessToken,
  isServiceAuthorization,
  checkApiAccess,
  secretsMatch,
} from '../../src/auth.js';
import { YHUB_SERVICE_TOKEN } from '../../src/config.js';

describe('Auth', () => {
  const secret = 'super-secret-key-at-least-32-characters-long';

  const DIGESTS: Record<string, string> = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };

  function createTestJwt(
    payload: object,
    key: string = secret,
    header: { alg: string; typ?: string } = { alg: 'HS256', typ: 'JWT' },
    digest: string = Object.hasOwn(DIGESTS, header.alg) ? DIGESTS[header.alg]! : 'sha256'
  ) {
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac(digest, key)
      .update(`${encodedHeader}.${body}`)
      .digest('base64url');
    return `${encodedHeader}.${body}.${sig}`;
  }

  describe('verifyAccessToken', () => {
    it('returns payload for valid token', () => {
      const token = createTestJwt({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 });
      const payload = verifyAccessToken(token, secret);
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe('user-123');
    });

    it('accepts every HMAC algorithm the API can sign with', () => {
      // jjwt signs with the strongest HMAC the configured key supports, so a
      // 32-byte dev secret produces HS384, not HS256.
      for (const alg of ['HS256', 'HS384', 'HS512']) {
        const token = createTestJwt(
          { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 },
          secret,
          { alg, typ: 'JWT' }
        );
        expect(verifyAccessToken(token, secret)?.sub).toBe('user-123');
      }
    });

    it('rejects a signature made with a digest the header does not declare', () => {
      const token = createTestJwt(
        { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 },
        secret,
        { alg: 'HS512', typ: 'JWT' },
        'sha256'
      );
      expect(verifyAccessToken(token, secret)).toBeNull();
    });

    it('returns null for expired token', () => {
      const token = createTestJwt({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 10 });
      expect(verifyAccessToken(token, secret)).toBeNull();
    });

    it('returns null for token with invalid signature', () => {
      const token = createTestJwt(
        { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 },
        'wrong-secret'
      );
      expect(verifyAccessToken(token, secret)).toBeNull();
    });

    it('returns null for malformed token', () => {
      expect(verifyAccessToken('not-a-jwt', secret)).toBeNull();
    });

    it('rejects a token outside the HMAC allowlist', () => {
      for (const alg of ['none', 'RS256', 'constructor']) {
        const token = createTestJwt(
          { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 },
          secret,
          { alg, typ: 'JWT' }
        );
        expect(verifyAccessToken(token, secret)).toBeNull();
      }
    });

    it('requires an expiry claim', () => {
      const token = createTestJwt({ sub: 'user-123' });
      expect(verifyAccessToken(token, secret)).toBeNull();
    });

    it('requires a subject claim', () => {
      const token = createTestJwt({ exp: Math.floor(Date.now() / 1000) + 60 });
      expect(verifyAccessToken(token, secret)).toBeNull();
    });
  });

  describe('secretsMatch', () => {
    it('matches equal values and rejects different ones', () => {
      expect(secretsMatch('same-value', 'same-value')).toBe(true);
      expect(secretsMatch('same-value', 'other-value')).toBe(false);
      expect(secretsMatch('short', 'a-much-longer-value')).toBe(false);
    });
  });

  describe('isServiceAuthorization', () => {
    it('accepts the configured service token from the Authorization header', () => {
      expect(isServiceAuthorization(`Bearer ${YHUB_SERVICE_TOKEN}`)).toBe(true);
      expect(isServiceAuthorization(YHUB_SERVICE_TOKEN)).toBe(true);
    });

    it('rejects a browser token and an absent header', () => {
      expect(isServiceAuthorization('Bearer not-the-service-token')).toBe(false);
      expect(isServiceAuthorization(undefined)).toBe(false);
      expect(isServiceAuthorization('Bearer ')).toBe(false);
    });
  });

  describe('checkApiAccess', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = originalFetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns access data on 200 response and sends the encoded id and credentials', async () => {
      const mockData = { accessLevel: 'EDIT', allowed: true, trashed: false };
      const fetchMock = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: mockData }),
        })
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(checkApiAccess('doc uuid/1', 'token-123')).resolves.toEqual(mockData);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        'http://localhost:8080/api/v1/internal/realtime/access?documentId=doc%20uuid%2F1'
      );
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Yhub-Service']).toBe(YHUB_SERVICE_TOKEN);
      expect(headers['Authorization']).toBe('Bearer token-123');
    });

    it('omits the bearer header when the caller supplies no token', async () => {
      const fetchMock = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: { allowed: false, trashed: false } }),
        })
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(checkApiAccess('doc-uuid-1')).resolves.toEqual({
        allowed: false,
        trashed: false,
      });

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Yhub-Service']).toBe(YHUB_SERVICE_TOKEN);
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('raises a transient 503 for a malformed envelope or verdict', async () => {
      const bodies = [
        { data: { allowed: true, trashed: false } },
        { success: true, data: { allowed: true } },
        { success: true, data: null },
        { success: false, data: { allowed: true, trashed: false } },
      ];

      for (const body of bodies) {
        global.fetch = jest.fn().mockImplementation(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(body),
          })
        ) as unknown as typeof fetch;

        await expect(checkApiAccess('doc-uuid-1')).rejects.toMatchObject({ status: 503 });
      }
    });

    it('returns null on a definitive denial', async () => {
      for (const status of [401, 403, 404]) {
        global.fetch = jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ ok: false, status })
          ) as unknown as typeof fetch;

        await expect(checkApiAccess('doc-uuid-1', 'token-123')).resolves.toBeNull();
      }
    });

    it('raises a transient 503 for a backend error instead of denying access', async () => {
      for (const status of [429, 500, 503]) {
        global.fetch = jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ ok: false, status })
          ) as unknown as typeof fetch;

        await expect(checkApiAccess('doc-uuid-1', 'token-123')).rejects.toMatchObject({
          status: 503,
        });
      }
    });

    it('raises a transient 503 when the backend is unreachable', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

      await expect(checkApiAccess('doc-uuid-1')).rejects.toMatchObject({ status: 503 });
    });

    it('raises a transient 503 for an unparseable body', async () => {
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('bad json')),
        })
      ) as unknown as typeof fetch;

      await expect(checkApiAccess('doc-uuid-1')).rejects.toMatchObject({ status: 503 });
    });
  });
});
