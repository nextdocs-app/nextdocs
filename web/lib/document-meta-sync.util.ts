import type * as Y from 'yjs';
import { isConnectivityError } from '@/lib/cloud-connectivity.util';
import type { DocumentAccessLevel } from '@/services/document.service';

// Yjs-shared document meta: `ydoc.getMap('meta')` carries the live title
// (key `title`) and the page icon/cover JSON strings (keys `icon`/`cover`).
// REST PATCH remains the durable source of truth for lists/trees; Yjs carries
// the keystroke-instant cross-client update.
export const YJS_META_MAP_KEY = 'meta';
export const YJS_META_TITLE_KEY = 'title';
export const YJS_META_ICON_KEY = 'icon';
export const YJS_META_COVER_KEY = 'cover';

export interface MetaWriteRoute {
  canCloud: boolean;
  canPublic: boolean;
}

/**
 * Single route decision for title and icon/cover writes.
 *
 * `updateMeta` and `commitIconCover` previously computed these gates inline
 * with identical conditions. One function keeps offline/guest/backoff
 * behavior identical for both pipelines.
 */
export function determineMetaWriteRoute({
  isAuthenticated,
  accessToken,
  isOnline,
  isSharedDocument,
  isPublicLinkDocument,
  accessLevel,
  inBackoff,
}: {
  isAuthenticated: boolean;
  accessToken: string | null;
  isOnline: boolean;
  isSharedDocument: boolean;
  isPublicLinkDocument: boolean;
  accessLevel: DocumentAccessLevel | null;
  inBackoff: boolean;
}): MetaWriteRoute {
  const canCloud = isAuthenticated && !!accessToken && isOnline && !inBackoff;
  const canPublic =
    !isAuthenticated &&
    (isSharedDocument || isPublicLinkDocument) &&
    (accessLevel === 'EDIT' || accessLevel === 'OWNER') &&
    isOnline &&
    !inBackoff;
  return { canCloud, canPublic };
}

/**
 * Shared persist dispatcher for `updateMeta` and `commitIconCover`.
 *
 * Both pipelines share one shape — durable remote write, mirror into the
 * local cache, fall back to local + pending-sync on connectivity loss, guarded
 * rollback otherwise — but different endpoints (metadata vs icon/cover). The
 * caller builds the remote promise and the two local mirrors; the dispatcher
 * owns the backoff/fallback/rollback sequencing so the two pipelines cannot
 * drift (the duplication between `updateMeta:1149` and `commitIconCover:1546`
 * that motivated it).
 */
export function persistMetaWrite({
  remoteWrite,
  mirrorRemote,
  persistLocal,
  queuePendingSync,
  queuePendingPatch,
  triggerBackoff,
  clearBackoff,
  rollback,
  logScope,
}: {
  /** Remote PATCH promise, or null for a local-only write. */
  remoteWrite: Promise<unknown> | null;
  /** IndexedDB mirror after a remote success (no pending-sync: it is durable). */
  mirrorRemote: () => Promise<void>;
  /** IndexedDB mirror + local-changed emit for local/offline writes. */
  persistLocal: () => Promise<void>;
  /** Pending-sync counter bump for offline replay (authenticated only). */
  queuePendingSync: () => void;
  /**
   * Queues the icon/cover patch the counter-flagged replay has to send, for the
   * same two paths that bump the counter. Omitted by title writes, which the
   * queued meta already carries.
   */
  queuePendingPatch?: () => void;
  triggerBackoff: () => void;
  clearBackoff: () => void;
  /** Guarded rollback — the caller captures the write seq. */
  rollback: () => void;
  /** Scope for error logs (`metadata update` vs `page icon/cover update`). */
  logScope: string;
}): void {
  const persistPromise = remoteWrite
    ? remoteWrite.then(async () => {
        try {
          await mirrorRemote();
        } catch (cacheErr) {
          console.warn(`Failed to mirror ${logScope} into local cache:`, cacheErr);
        }
      })
    : persistLocal().then(() => {
        queuePendingSync();
        queuePendingPatch?.();
      });

  persistPromise
    .then(() => {
      if (remoteWrite) {
        clearBackoff();
      }
    })
    .catch(async (err) => {
      if (remoteWrite && isConnectivityError(err)) {
        triggerBackoff();

        try {
          await persistLocal();
          queuePendingSync();
          queuePendingPatch?.();
          return;
        } catch (localErr) {
          console.error(`Failed to persist ${logScope}:`, localErr);
        }
      } else {
        console.error(`Failed to persist ${logScope}:`, err);
      }

      rollback();
    });
}

/**
 * Mirrors one title into the shared Yjs map for instant cross-client sync.
 * The map observer ignores this echo, and remote applies never write back,
 * so no loop is possible. REST remains the durable persist.
 */
export function mirrorTitleToYjs(
  ydoc: Y.Doc | null,
  title: string,
  lastLocalTitleRef: React.MutableRefObject<string | null>
): void {
  if (!ydoc) {
    return;
  }
  try {
    lastLocalTitleRef.current = title;
    const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);
    if (metaMap.get(YJS_META_TITLE_KEY) !== title) {
      metaMap.set(YJS_META_TITLE_KEY, title);
    }
  } catch (err) {
    console.warn('Failed to mirror title into Yjs:', err);
  }
}

/**
 * Reverts an optimistic icon/cover mirror after the server rejects it.
 *
 * The optimistic write already broadcast the rejected value to peers, so
 * rolling back Redux alone leaves collaborators diverged. Restoring the
 * previous JSON (or deleting the key when there was none) broadcasts the
 * undo to every client through the same Yjs map the optimistic value used.
 * Echo guards are set to the restored value so the local observer ignores
 * its own revert echo, exactly like the forward mirror.
 */
export function revertIconCoverInYjs(
  ydoc: Y.Doc | null,
  prevIconJson: string | null,
  prevCoverJson: string | null,
  lastLocalIconRef: React.MutableRefObject<string | null | undefined>,
  lastLocalCoverRef: React.MutableRefObject<string | null | undefined>
): void {
  mirrorIconCoverToYjs(ydoc, prevIconJson, prevCoverJson, lastLocalIconRef, lastLocalCoverRef);
}

/**
 * Mirrors the icon/cover JSON strings into the shared Yjs map, parallel to
 * `mirrorTitleToYjs`. Echo guards record the exact JSON written (or null for
 * a deletion) so the observer can tell our own write from a remote one.
 */
export function mirrorIconCoverToYjs(
  ydoc: Y.Doc | null,
  iconJson: string | null,
  coverJson: string | null,
  lastLocalIconRef: React.MutableRefObject<string | null | undefined>,
  lastLocalCoverRef: React.MutableRefObject<string | null | undefined>
): void {
  if (!ydoc) {
    return;
  }
  try {
    const metaMap = ydoc.getMap<string>(YJS_META_MAP_KEY);
    if (iconJson === null) {
      if (metaMap.has(YJS_META_ICON_KEY)) {
        lastLocalIconRef.current = null;
        metaMap.delete(YJS_META_ICON_KEY);
      }
    } else if (metaMap.get(YJS_META_ICON_KEY) !== iconJson) {
      lastLocalIconRef.current = iconJson;
      metaMap.set(YJS_META_ICON_KEY, iconJson);
    }
    if (coverJson === null) {
      if (metaMap.has(YJS_META_COVER_KEY)) {
        lastLocalCoverRef.current = null;
        metaMap.delete(YJS_META_COVER_KEY);
      }
    } else if (metaMap.get(YJS_META_COVER_KEY) !== coverJson) {
      lastLocalCoverRef.current = coverJson;
      metaMap.set(YJS_META_COVER_KEY, coverJson);
    }
  } catch (err) {
    console.warn('Failed to mirror page icon/cover into Yjs:', err);
  }
}
