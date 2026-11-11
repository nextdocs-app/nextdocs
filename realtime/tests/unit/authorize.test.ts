import { describe, expect, it } from '@jest/globals';
import { buildAuthCallbacks, type AuthDeps } from '../../src/authorize.js';
import {
  adminDocumentPermissions,
  documentPermissions,
  serviceOrgPermissions,
} from '../../src/permissions.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const docRef = { org: 'nextdocs', docid: documentId, branch: 'main' };

function request(
  headers: Record<string, string | undefined> = {},
  query: Record<string, string | undefined> = {}
) {
  return {
    getHeader: (name: string) => headers[name.toLowerCase()],
    getQuery: (name: string) => query[name],
  };
}

function build(overrides: Partial<AuthDeps> = {}) {
  const calls = { checked: [] as string[], authorized: [] as string[], verified: [] as string[] };
  const deps: AuthDeps = {
    org: 'nextdocs',
    uuidRegex: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    jwtSecret: 'test-secret',
    isService: () => false,
    verifyToken: (token) => {
      calls.verified.push(token);
      return { sub: 'user-1' };
    },
    checkAccess: async (id) => {
      calls.checked.push(id);
      return { allowed: true, trashed: false, accessLevel: 'EDIT' };
    },
    onAuthorized: (id) => calls.authorized.push(id),
    ...overrides,
  };
  return { callbacks: buildAuthCallbacks(deps), calls };
}

describe('authenticate', () => {
  it('accepts the service identity only from the Authorization header', async () => {
    const service = build({ isService: (header) => header === 'Bearer service-token' });

    await expect(
      service.callbacks.authenticate(request({ authorization: 'Bearer service-token' }))
    ).resolves.toEqual({ userid: 'service', isService: true });

    const queryOnly = build({ isService: (header) => header === 'Bearer service-token' });
    await expect(
      queryOnly.callbacks.authenticate(request({}, { token: 'service-token' }))
    ).resolves.toEqual({ userid: 'user-1', token: 'service-token' });
    expect(queryOnly.calls.verified).toEqual(['service-token']);
  });

  it('strips a case-insensitive Bearer scheme', async () => {
    const { callbacks, calls } = build();

    await expect(
      callbacks.authenticate(request({ authorization: 'bearer access-token' }))
    ).resolves.toEqual({ userid: 'user-1', token: 'access-token' });
    expect(calls.verified).toEqual(['access-token']);
  });

  it('falls back to the query token for browser connections', async () => {
    const { callbacks } = build();

    await expect(
      callbacks.authenticate(request({}, { token: '  query-token  ' }))
    ).resolves.toEqual({ userid: 'user-1', token: 'query-token' });
  });

  it('treats a request without any credential as anonymous', async () => {
    const { callbacks, calls } = build();

    await expect(callbacks.authenticate(request())).resolves.toEqual({ userid: 'anonymous' });
    expect(calls.verified).toEqual([]);
  });

  it('rejects a token the API cannot verify', async () => {
    const { callbacks } = build({ verifyToken: () => null });

    await expect(
      callbacks.authenticate(request({ authorization: 'Bearer expired' }))
    ).rejects.toThrow('Invalid or expired token');
  });
});

describe('authorize.document', () => {
  it('grants the service admin permissions without asking the API', async () => {
    const { callbacks, calls } = build();

    await expect(
      callbacks.authorize.document(docRef, { userid: 'service', isService: true })
    ).resolves.toEqual(adminDocumentPermissions);
    expect(calls.checked).toEqual([]);
  });

  it.each([
    ['another organization', { ...docRef, org: 'other' }],
    ['a non-main branch', { ...docRef, branch: 'draft' }],
    ['a malformed document id', { ...docRef, docid: 'not-a-uuid' }],
  ])('denies %s without asking the API', async (_label, ref) => {
    const { callbacks, calls } = build();

    await expect(callbacks.authorize.document(ref, { userid: 'user-1' })).resolves.toBeNull();
    expect(calls.checked).toEqual([]);
  });

  it.each([
    ['a denied verdict', { allowed: false, trashed: false, accessLevel: null }],
    ['a trashed document', { allowed: true, trashed: true, accessLevel: 'EDIT' }],
    ['an allowed verdict with no level', { allowed: true, trashed: false, accessLevel: null }],
  ])('denies %s', async (_label, verdict) => {
    const { callbacks, calls } = build({ checkAccess: async () => verdict });

    await expect(callbacks.authorize.document(docRef, { userid: 'user-1' })).resolves.toBeNull();
    expect(calls.authorized).toEqual([]);
  });

  it('denies when the API cannot answer', async () => {
    const { callbacks } = build({ checkAccess: async () => null });

    await expect(callbacks.authorize.document(docRef, { userid: 'user-1' })).resolves.toBeNull();
  });

  it('maps an EDIT verdict to write permissions and marks the room active', async () => {
    const { callbacks, calls } = build();

    await expect(
      callbacks.authorize.document(docRef, { userid: 'user-1', token: 'jwt' })
    ).resolves.toEqual(documentPermissions('EDIT'));
    expect(calls.checked).toEqual([documentId]);
    expect(calls.authorized).toEqual([documentId]);
  });

  it('passes the browser token through to the access check', async () => {
    const seen: Array<string | null | undefined> = [];
    const { callbacks } = build({
      checkAccess: async (_id, token) => {
        seen.push(token);
        return { allowed: true, trashed: false, accessLevel: 'VIEW' };
      },
    });

    await callbacks.authorize.document(docRef, { userid: 'user-1', token: 'jwt' });
    expect(seen).toEqual(['jwt']);
  });
});

describe('authorize.org and global', () => {
  it('grants the organization only to the service identity in this organization', async () => {
    const { callbacks } = build();
    const serviceUser = { userid: 'service', isService: true };

    await expect(callbacks.authorize.org({ org: 'nextdocs' }, serviceUser)).resolves.toEqual(
      serviceOrgPermissions
    );
    await expect(callbacks.authorize.org({ org: 'other' }, serviceUser)).resolves.toBeNull();
    await expect(
      callbacks.authorize.org({ org: 'nextdocs' }, { userid: 'user-1' })
    ).resolves.toBeNull();
  });

  it('exposes read-only health and ping endpoints', async () => {
    const { callbacks } = build();

    await expect(callbacks.authorize.global()).resolves.toEqual({
      type: 'permissions:global:v1',
      endpoint: { health: '-r--', ping: '-r--' },
    });
  });
});
