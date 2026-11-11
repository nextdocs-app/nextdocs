import { describe, it, expect } from '@jest/globals';
import {
  documentPermissions,
  adminDocumentPermissions,
  serviceOrgPermissions,
} from '../../src/permissions.js';

describe('Permissions', () => {
  it('maps VIEW to read-only document and read-only awareness', () => {
    const perms = documentPermissions('VIEW');
    expect(perms.ydoc).toBe('-r--');
    expect(perms.awareness).toBe('-r--');
    expect(perms.endpoint.ws).toBe('-r--');
    expect(perms.endpoint.ydoc).toBe('-r--');
  });

  it('maps COMMENT to read-only document but write awareness for presence/pings', () => {
    const perms = documentPermissions('COMMENT');
    expect(perms.ydoc).toBe('-r--');
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-r--');
    expect(perms.endpoint.ydoc).toBe('-r--');
  });

  it('maps EDIT to write document and write awareness', () => {
    const perms = documentPermissions('EDIT');
    expect(perms.ydoc).toBe('-ru-');
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-ru-');
    expect(perms.endpoint.ydoc).toBe('-ru-');
  });

  it('maps OWNER to write document and write awareness', () => {
    const perms = documentPermissions('OWNER');
    expect(perms.ydoc).toBe('-ru-');
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-ru-');
    expect(perms.endpoint.ydoc).toBe('-ru-');
  });

  it('denies an unknown access level instead of falling through to write', () => {
    // The level is read from an API response, so a malformed or future value must not
    // inherit the EDIT branch.
    expect(documentPermissions('NO_ACCESS')).toBeNull();
    expect(documentPermissions('ADMIN')).toBeNull();
    expect(documentPermissions('')).toBeNull();
  });

  it('grants the service only the endpoints the API actually calls', () => {
    expect(adminDocumentPermissions.ydoc).toBe('-ru-');
    expect(adminDocumentPermissions.delete).toEqual(['soft', 'hard']);
    expect(adminDocumentPermissions.endpoint).toEqual({ ws: 'crud', ydoc: 'crud' });
    // A wildcard would silently grant future Yhub endpoints to the service token.
    expect(adminDocumentPermissions.endpoint['*']).toBeUndefined();
    expect(adminDocumentPermissions.history).toBeUndefined();
  });

  it('grants the service only the org-scoped recheck', () => {
    expect(serviceOrgPermissions.type).toBe('permissions:org:v1');
    expect(serviceOrgPermissions.endpoint).toEqual({ recheck: 'c---' });
  });
});
