import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import crypto from 'crypto';
import {
  verifyHs256Jwt,
  isServiceAuthorization,
  checkApiAccess,
  secretsMatch,
} from '../../src/auth.js';
import { YHUB_SERVICE_TOKEN } from '../../src/config.js';

describe('Auth', () => {
  const secret = 'super-secret-key-at-least-32-characters-long';

  function createTestJwt(
    payload: object,
    key: string = secret,
    header: object = { alg: 'HS256', typ: 'JWT' }
  ) {
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', key)
      .update(`${encodedHeader}.${body}`)
      .digest('base64url');
    return `${encodedHeader}.${body}.${sig}`;
  }

  describe('verifyHs256Jwt', () => {
    it('returns payload for valid token', () => {
      const token = createTestJwt({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 });
      const payload = verifyHs256Jwt(token, secret);
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe('user-123');
    });

    it('returns null for expired token', () => {
      const token = createTestJwt({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 10 });
      expect(verifyHs256Jwt(token, secret)).toBeNull();
    });

    it('returns null for token with invalid signature', () => {
      const token = createTestJwt(
        { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 },
        'wrong-secret'
      );
      expect(verifyHs256Jwt(token, secret)).toBeNull();
    });

    it('returns null for malformed token', () => {
      expect(verifyHs256Jwt('not-a-jwt', secret)).toBeNull();
    });

    it('rejects a token that is not HS256', () => {
      const token = createTestJwt(
        { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 },
        secret,
        {
          alg: 'none',
          typ: 'JWT',
        }
      );
      expect(verifyHs256Jwt(token, secret)).toBeNull();
    });

    it('requires an expiry claim', () => {
      const token = createTestJwt({ sub: 'user-123' });
      expect(verifyHs256Jwt(token, secret)).toBeNull();
    });

    it('requires a subject claim', () => {
      const token = createTestJwt({ exp: Math.floor(Date.now() / 1000) + 60 });
      expect(verifyHs256Jwt(token, secret)).toBeNull();
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

    it('returns access data on 200 response', async () => {
      const mockData = { accessLevel: 'EDIT', allowed: true, trashed: false };
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockData }),
        })
      ) as unknown as typeof fetch;

      await expect(checkApiAccess('doc-uuid-1', 'token-123')).resolves.toEqual(mockData);
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
