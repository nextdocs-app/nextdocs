import { describe, it, expect } from '@jest/globals';
import {
  documentPermissions,
  adminDocumentPermissions,
  serviceOrgPermissions,
} from '../../src/permissions.js';

describe('Permissions', () => {
  it('maps VIEW to a read-only document but write awareness for presence', () => {
    const perms = documentPermissions('VIEW');
    expect(perms.ydoc).toBe('-r--');
    // Presence is ephemeral and never reaches the Y.Doc, so a reader broadcasts it or
    // the toolbar could not show them as "here now".
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-r--');
    expect(perms.endpoint.ydoc).toBe('-r--');
    // A viewer may inspect the timeline and named versions but cannot roll back:
    // restore writes the document, so no rollback bit and no version mutations.
    expect(perms.history).toEqual({ from: 0, version: '-r--' });
    // A viewer must never be able to create or remove a comment anchor.
    expect(perms.endpoint.anchor).toBeUndefined();
  });

  it('maps COMMENT to read-only document but write awareness for presence/pings', () => {
    const perms = documentPermissions('COMMENT');
    expect(perms.ydoc).toBe('-r--');
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-r--');
    expect(perms.endpoint.ydoc).toBe('-r--');
    // Commenters read history; restoring or naming versions mutates the Y.Doc.
    expect(perms.history).toEqual({ from: 0, version: '-r--' });
    // The only Y.Doc mutation COMMENT may request: the server inserts the mark.
    // `d` exists for orphan cleanup after the API reports the thread gone.
    expect(perms.endpoint.anchor).toBe('c--d');
  });

  it('maps EDIT to write document, write awareness and restorable history', () => {
    const perms = documentPermissions('EDIT');
    expect(perms.ydoc).toBe('-ru-');
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-ru-');
    expect(perms.endpoint.ydoc).toBe('-ru-');
    expect(perms.endpoint.activity).toBe('-r--');
    expect(perms.endpoint.changeset).toBe('-r--');
    expect(perms.endpoint.version).toBe('crud');
    expect(perms.endpoint.rollback).toBe('c---');
    expect(perms.endpoint.anchor).toBe('c--d');
    expect(perms.history).toEqual({ from: 0, rollback: true, version: 'crud' });
  });

  it('maps OWNER to write document, write awareness and restorable history', () => {
    const perms = documentPermissions('OWNER');
    expect(perms.ydoc).toBe('-ru-');
    expect(perms.awareness).toBe('-ru-');
    expect(perms.endpoint.ws).toBe('-ru-');
    expect(perms.endpoint.ydoc).toBe('-ru-');
    expect(perms.endpoint.activity).toBe('-r--');
    expect(perms.endpoint.changeset).toBe('-r--');
    expect(perms.endpoint.version).toBe('crud');
    expect(perms.endpoint.rollback).toBe('c---');
    expect(perms.endpoint.anchor).toBe('c--d');
    expect(perms.history).toEqual({ from: 0, rollback: true, version: 'crud' });
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

  it('grants the service only the org-scoped recheck and search reindex', () => {
    expect(serviceOrgPermissions.type).toBe('permissions:org:v1');
    expect(serviceOrgPermissions.endpoint).toEqual({ recheck: 'c---', 'search-reindex': 'c---' });
  });
});
