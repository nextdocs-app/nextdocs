import * as Y from 'yjs';
import { waitFor } from '@testing-library/react';
import { DocumentServiceApiError } from '../../../services/document.service';
import {
  determineMetaWriteRoute,
  mirrorIconCoverToYjs,
  mirrorTitleToYjs,
  persistMetaWrite,
  YJS_META_COVER_KEY,
  YJS_META_ICON_KEY,
  YJS_META_MAP_KEY,
  YJS_META_TITLE_KEY,
} from '../../../lib/document-meta-sync.util';

describe('determineMetaWriteRoute', () => {
  const base = {
    isAuthenticated: true,
    accessToken: 'token',
    isOnline: true,
    isSharedDocument: false,
    isPublicLinkDocument: false,
    accessLevel: 'OWNER' as const,
    inBackoff: false,
  };

  it('routes signed-in online writers to the cloud', () => {
    expect(determineMetaWriteRoute(base)).toEqual({ canCloud: true, canPublic: false });
  });

  it('routes edit-level guests on a share link to the public endpoint', () => {
    const route = determineMetaWriteRoute({
      ...base,
      isAuthenticated: false,
      accessToken: null,
      isSharedDocument: true,
      accessLevel: 'EDIT',
    });

    expect(route).toEqual({ canCloud: false, canPublic: true });
  });

  it('denies view-level guests the public write', () => {
    const route = determineMetaWriteRoute({
      ...base,
      isAuthenticated: false,
      accessToken: null,
      isSharedDocument: true,
      accessLevel: 'VIEW',
    });

    expect(route).toEqual({ canCloud: false, canPublic: false });
  });

  it('parks both routes while offline or in backoff', () => {
    expect(determineMetaWriteRoute({ ...base, isOnline: false })).toEqual({
      canCloud: false,
      canPublic: false,
    });
    expect(determineMetaWriteRoute({ ...base, inBackoff: true })).toEqual({
      canCloud: false,
      canPublic: false,
    });
  });
});

describe('persistMetaWrite', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('mirrors a remote success into the cache and clears backoff without queueing sync', async () => {
    const remote = deferred<unknown>();
    const mirrorRemote = jest.fn().mockResolvedValue(undefined);
    const persistLocal = jest.fn().mockResolvedValue(undefined);
    const queuePendingSync = jest.fn();
    const queuePendingPatch = jest.fn();
    const clearBackoff = jest.fn();
    const rollback = jest.fn();

    persistMetaWrite({
      remoteWrite: remote.promise,
      mirrorRemote,
      persistLocal,
      queuePendingSync,
      queuePendingPatch,
      triggerBackoff: jest.fn(),
      clearBackoff,
      rollback,
      logScope: 'metadata update',
    });
    remote.resolve(undefined);

    await waitFor(() => {
      expect(mirrorRemote).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(clearBackoff).toHaveBeenCalledTimes(1);
    });
    expect(persistLocal).not.toHaveBeenCalled();
    expect(queuePendingSync).not.toHaveBeenCalled();
    expect(queuePendingPatch).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('falls back to local plus pending sync on a connectivity failure, without rollback', async () => {
    const remote = deferred<unknown>();
    const persistLocal = jest.fn().mockResolvedValue(undefined);
    const queuePendingSync = jest.fn();
    const queuePendingPatch = jest.fn();
    const triggerBackoff = jest.fn();
    const rollback = jest.fn();

    persistMetaWrite({
      remoteWrite: remote.promise,
      mirrorRemote: jest.fn().mockResolvedValue(undefined),
      persistLocal,
      queuePendingSync,
      queuePendingPatch,
      triggerBackoff,
      clearBackoff: jest.fn(),
      rollback,
      logScope: 'page icon/cover update',
    });
    remote.reject(new TypeError('Failed to fetch'));

    await waitFor(() => {
      expect(triggerBackoff).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(persistLocal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(queuePendingSync).toHaveBeenCalledTimes(1);
    });
    // Losing connectivity mid-write must queue the explicit icon/cover payload,
    // not only the counter: an omitted icon reads as "leave unchanged".
    await waitFor(() => {
      expect(queuePendingPatch).toHaveBeenCalledTimes(1);
    });
    expect(rollback).not.toHaveBeenCalled();
  });

  it('keeps the local edit and re-auths on a 401 instead of rolling back', async () => {
    const remote = deferred<unknown>();
    const persistLocal = jest.fn().mockResolvedValue(undefined);
    const queuePendingSync = jest.fn();
    const refreshSession = jest.fn();
    const rollback = jest.fn();

    persistMetaWrite({
      remoteWrite: remote.promise,
      mirrorRemote: jest.fn().mockResolvedValue(undefined),
      persistLocal,
      queuePendingSync,
      triggerBackoff: jest.fn(),
      clearBackoff: jest.fn(),
      refreshSession,
      rollback,
      logScope: 'metadata update',
    });
    remote.reject(new DocumentServiceApiError('Authentication required.', 401));

    await waitFor(() => {
      expect(persistLocal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(queuePendingSync).toHaveBeenCalledTimes(1);
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('rolls back a non-connectivity remote failure', async () => {
    const remote = deferred<unknown>();
    const rollback = jest.fn();

    persistMetaWrite({
      remoteWrite: remote.promise,
      mirrorRemote: jest.fn().mockResolvedValue(undefined),
      persistLocal: jest.fn().mockResolvedValue(undefined),
      queuePendingSync: jest.fn(),
      triggerBackoff: jest.fn(),
      clearBackoff: jest.fn(),
      rollback,
      logScope: 'metadata update',
    });
    remote.reject(new Error('403 Forbidden'));

    await waitFor(() => {
      expect(rollback).toHaveBeenCalledTimes(1);
    });
  });

  it('persists locally and queues sync for a local-only write', async () => {
    const persistLocal = jest.fn().mockResolvedValue(undefined);
    const queuePendingSync = jest.fn();
    const queuePendingPatch = jest.fn();
    const clearBackoff = jest.fn();
    const rollback = jest.fn();

    persistMetaWrite({
      remoteWrite: null,
      mirrorRemote: jest.fn().mockResolvedValue(undefined),
      persistLocal,
      queuePendingSync,
      queuePendingPatch,
      triggerBackoff: jest.fn(),
      clearBackoff,
      rollback,
      logScope: 'metadata update',
    });

    await waitFor(() => {
      expect(persistLocal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(queuePendingSync).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(queuePendingPatch).toHaveBeenCalledTimes(1);
    });
    expect(clearBackoff).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });
});

describe('mirrorTitleToYjs', () => {
  it('writes the title and records the echo guard', () => {
    const ydoc = new Y.Doc();
    const guard = { current: null as string | null };

    mirrorTitleToYjs(ydoc, 'Hello', guard);

    expect(ydoc.getMap<string>(YJS_META_MAP_KEY).get(YJS_META_TITLE_KEY)).toBe('Hello');
    expect(guard.current).toBe('Hello');
  });

  it('skips the write when the map already holds the title', () => {
    const ydoc = new Y.Doc();
    ydoc.getMap<string>(YJS_META_MAP_KEY).set(YJS_META_TITLE_KEY, 'Same');
    const guard = { current: null as string | null };

    mirrorTitleToYjs(ydoc, 'Same', guard);

    expect(guard.current).toBe('Same');
    expect(ydoc.getMap<string>(YJS_META_MAP_KEY).get(YJS_META_TITLE_KEY)).toBe('Same');
  });
});

describe('mirrorIconCoverToYjs', () => {
  it('sets icon/cover JSON and deletes keys on clear', () => {
    const ydoc = new Y.Doc();
    const iconGuard = { current: undefined as string | null | undefined };
    const coverGuard = { current: undefined as string | null | undefined };
    const iconJson = JSON.stringify({ type: 'emoji', value: '📝' });
    const coverJson = JSON.stringify({ type: 'link', value: 'https://cdn.example/c.jpg' });

    mirrorIconCoverToYjs(ydoc, iconJson, coverJson, iconGuard, coverGuard);
    const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);
    expect(metaMap.get(YJS_META_ICON_KEY)).toBe(iconJson);
    expect(metaMap.get(YJS_META_COVER_KEY)).toBe(coverJson);

    mirrorIconCoverToYjs(ydoc, null, null, iconGuard, coverGuard);
    expect(metaMap.has(YJS_META_ICON_KEY)).toBe(false);
    expect(metaMap.has(YJS_META_COVER_KEY)).toBe(false);
    expect(iconGuard.current).toBeNull();
    expect(coverGuard.current).toBeNull();
  });
});
