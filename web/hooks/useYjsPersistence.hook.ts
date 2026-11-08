import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  documentService,
  DocumentServiceApiError,
  type DocumentAccessLevel,
} from '@/services/document.service';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { useAuth } from '@/hooks/useAuth.hook';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { useCloudBackoff } from '@/hooks/useCloudBackoff.hook';
import {
  setSaving,
  setLastSaved,
  setError,
  updateMeta as updateMetaAction,
} from '@/stores/document/document.slice';
import type { DocumentMeta } from '@/types/document.types';
import {
  acknowledgePendingSyncEdits,
  clearPendingIconCoverPatch,
  clearPendingMetaPatch,
  countPendingMetadataMarkers,
  markPendingSyncEdits,
  PENDING_SYNC_EVENT,
  pendingMetaOwner,
  readPendingIconCoverPatch,
  readPendingMetaPatch,
  readPendingSyncEdits,
  writePendingMetaPatch,
  writePendingSyncEdits,
} from '@/lib/offline-sync.util';
import {
  backoffMsFor,
  isConnectivityError,
  isUnauthorizedError,
} from '@/lib/cloud-connectivity.util';
import {
  discardPendingDocument,
  flushPendingCloudCreate,
  getPendingCloudCreate,
} from '@/lib/pending-cloud-create.util';

const SAVE_DEBOUNCE_MS = 500;

export function useYjsPersistence(
  documentId: string,
  ydoc: Y.Doc | null,
  meta: DocumentMeta | null,
  isReadOnly = false,
  canPersistCloud = true,
  accessLevel?: DocumentAccessLevel | null,
  /** Whether the realtime provider has completed a Yjs sync for this document. */
  isRealtimeSynced = false
) {
  const dispatch = useAppDispatch();
  const { isSaving, lastSaved } = useAppSelector((state) => state.document);
  const { isAuthenticated, accessToken, user, refresh } = useAuth();
  const { isOnline } = useNetworkStatus();
  const { trigger: triggerBackoff, clear: clearBackoff, isInBackoff } = useCloudBackoff();

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isFlushingPendingRef = useRef(false);
  const directSavesInFlightRef = useRef(0);
  // Bumped on every local snapshot. A cloud save captures the revision it
  // started with and only clears the pending marker if no newer snapshot
  // landed while it was in flight.
  const localRevisionRef = useRef(0);
  const [pendingEdits, setPendingEdits] = useState(() => readPendingSyncEdits(documentId));
  const pendingEditsRef = useRef(pendingEdits);

  // We use a ref to avoid recreating the timeout handler when meta changes
  const metaRef = useRef(meta);
  // Meta starts null while the document loads and only ever becomes non-null
  // once for a mounted document; depending on this instead of `meta` keeps the
  // save effect (and its debounced timer) alive across keystrokes.
  const hasMeta = meta !== null;

  const metaOwner = pendingMetaOwner(user?.id);
  const metaOwnerRef = useRef(metaOwner);
  metaOwnerRef.current = metaOwner;

  // A save can outlive the sync state it started with. Reading the prop captured at
  // the start would add a content marker after the sync already handed that content
  // to Yhub, leaving a stale "unsaved" marker forever.
  const isRealtimeSyncedRef = useRef(isRealtimeSynced);
  useEffect(() => {
    isRealtimeSyncedRef.current = isRealtimeSynced;
  }, [isRealtimeSynced]);

  // Content markers this tab is entitled to acknowledge, adopted from the shared
  // counter at mount because the local copy this tab loaded (and will sync) carries
  // those edits; later saves add one each. Another tab's offline edits are not part
  // of this tab's synced state, so its markers stay until that tab syncs.
  const ownedContentMarkersRef = useRef(0);
  // Markers that predate this mount are the legacy queue: the old content save
  // carried the title in its body, so a rename may still be waiting for REST.
  const markersAtMountRef = useRef(0);

  // A save snapshots meta before its network round-trip, and a title keystroke
  // can land while that write is in flight. Restoring the whole snapshot would
  // roll the editor back to an older prefix of the title, so only the saved
  // timestamp is merged into the live meta.
  const reconcileSavedMeta = useCallback(
    (savedMeta: DocumentMeta) => {
      dispatch(updateMetaAction({ updatedAt: savedMeta.updatedAt }));
    },
    [dispatch]
  );

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    pendingEditsRef.current = pendingEdits;
  }, [pendingEdits]);

  useEffect(() => {
    const nextPending = readPendingSyncEdits(documentId);
    ownedContentMarkersRef.current = nextPending;
    markersAtMountRef.current = nextPending;
    pendingEditsRef.current = nextPending;
    setPendingEdits(nextPending);
  }, [documentId]);

  /**
   * Writes a marker without lowering a higher one another tab already wrote: the
   * counter is shared through localStorage, so overwriting it would consume edits
   * this tab has never seen.
   */
  const publishPendingMarker = useCallback(
    (marker: number) => {
      const published = writePendingSyncEdits(
        documentId,
        Math.max(readPendingSyncEdits(documentId), marker)
      );
      pendingEditsRef.current = published;
      setPendingEdits(published);
      return published;
    },
    [documentId]
  );

  // A completed Yjs sync hands this document's whole state to Yhub, so the content
  // markers this tab queued while the socket was away are receipted. Metadata markers
  // stay: their PATCH has not run yet, and a sync must never discard a queued title.
  useEffect(() => {
    if (!isRealtimeSynced || isReadOnly) {
      return;
    }

    const owner = metaOwnerRef.current;
    let metadataMarkers = countPendingMetadataMarkers(owner, documentId);
    const pending = readPendingSyncEdits(documentId);
    if (pending <= metadataMarkers) {
      return;
    }

    // A content marker with no queued metadata patch can hide a legacy title rename:
    // the old content save carried the title in its body, and Yjs does not. Queue the
    // live title (the room's latest, so it cannot be older than the server's) before
    // the marker is cleared, and let the REST replay persist documents.title.
    const currentTitle = metaRef.current?.title;
    if (
      isAuthenticated &&
      markersAtMountRef.current > 0 &&
      !readPendingMetaPatch(owner, documentId) &&
      typeof currentTitle === 'string'
    ) {
      writePendingMetaPatch(owner, documentId, { title: currentTitle });
      metadataMarkers += 1;
    }
    markersAtMountRef.current = 0;

    // Only the markers this tab wrote (or adopted with the local copy it loaded) are
    // proven included in the sync. A marker from another tab's offline session stays.
    const ownedMarkers = Math.min(
      ownedContentMarkersRef.current,
      Math.max(0, pending - metadataMarkers)
    );
    if (ownedMarkers <= 0) {
      return;
    }

    ownedContentMarkersRef.current = 0;
    // Receipting lowers the counter, so this must not go through the "never lower"
    // publisher that guards markers written by another tab.
    const published = writePendingSyncEdits(documentId, pending - ownedMarkers);
    pendingEditsRef.current = published;
    setPendingEdits(published);
    dispatch(setLastSaved(new Date().toISOString()));
  }, [isRealtimeSynced, documentId, isReadOnly, isAuthenticated, metaOwner, dispatch]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePendingSyncChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string; pendingEdits: number }>).detail;
      if (!detail || detail.documentId !== documentId) {
        return;
      }

      pendingEditsRef.current = detail.pendingEdits;
      setPendingEdits(detail.pendingEdits);
    };

    window.addEventListener(PENDING_SYNC_EVENT, handlePendingSyncChanged as EventListener);
    return () => {
      window.removeEventListener(PENDING_SYNC_EVENT, handlePendingSyncChanged as EventListener);
    };
  }, [documentId]);

  const persistLocalSnapshot = useCallback(
    async (options: { emit?: boolean; publishPending?: boolean } = {}) => {
      if (!ydoc || isReadOnly) {
        return { revision: 0, pendingMarker: 0 };
      }

      const currentMeta = metaRef.current;
      if (!currentMeta) {
        return { revision: 0, pendingMarker: 0 };
      }

      const savedMeta = { ...currentMeta, updatedAt: new Date().toISOString() };
      // The flag is set only when this tab opened the document through a share
      // link, signed in or not; the mirror must keep that provenance either way.
      const linkOrigin = documentService.isPublicLinkDocument(documentId)
        ? ({ origin: 'public-link' } as const)
        : undefined;

      await documentService.saveDocument(
        documentId,
        ydoc,
        savedMeta,
        linkOrigin ? { origin: linkOrigin.origin } : undefined
      );

      localRevisionRef.current += 1;
      const revision = localRevisionRef.current;

      if (options.emit !== false) {
        documentService.emitLocalDocumentsChanged();
      }
      reconcileSavedMeta(savedMeta);

      // A signed-in edit is queued even while the access token is refreshing:
      // the local copy is the durable part, and the flush runs once a token
      // exists. Guests and public links have no cloud queue of their own.
      if (!isAuthenticated || !canPersistCloud) {
        return { revision, pendingMarker: 0 };
      }

      // Content reaches Yhub over the socket, so a synced provider has already taken
      // the edit and needs no marker. An unsynced one (offline, reconnecting) does:
      // the marker keeps this device's copy authoritative until a sync acknowledges it.
      // The live ref matters here: this save may have started before a sync completed,
      // and reading the captured prop would leave a marker the sync already covered.
      const addsContentMarker = !isRealtimeSyncedRef.current;
      const nextPendingEdits = readPendingSyncEdits(documentId) + (addsContentMarker ? 1 : 0);
      if (addsContentMarker) {
        ownedContentMarkersRef.current += 1;
      }
      const pendingMarker = options.publishPending
        ? publishPendingMarker(nextPendingEdits)
        : markPendingSyncEdits(documentId, nextPendingEdits);

      if (options.publishPending) {
        pendingEditsRef.current = pendingMarker;
        setPendingEdits(pendingMarker);
      }

      return { revision, pendingMarker };
    },
    [
      documentId,
      ydoc,
      isReadOnly,
      isAuthenticated,
      canPersistCloud,
      reconcileSavedMeta,
      publishPendingMarker,
    ]
  );

  const flushPendingEditsToCloud = useCallback(async () => {
    if (isReadOnly || !isOnline) {
      return;
    }

    const owner = metaOwnerRef.current;

    // A guest on an edit-level share link has no cloud session, but a title that
    // failed to PATCH must still reach REST: lists and search read documents.title.
    // The replay uses the public metadata endpoint and the guest's own queue scope.
    if (!isAuthenticated) {
      if (!documentService.isPublicLinkDocument(documentId)) {
        return;
      }
      const queuedTitle = readPendingMetaPatch(owner, documentId)?.title;
      if (
        queuedTitle === undefined ||
        isInBackoff() ||
        isFlushingPendingRef.current ||
        directSavesInFlightRef.current > 0
      ) {
        return;
      }

      isFlushingPendingRef.current = true;
      try {
        await documentService.updatePublicMetadata(documentId, { title: queuedTitle });
        if (readPendingMetaPatch(owner, documentId)?.title === queuedTitle) {
          clearPendingMetaPatch(owner, documentId, queuedTitle);
          acknowledgePendingSyncEdits(documentId);
        }
        clearBackoff();
        dispatch(setLastSaved(new Date().toISOString()));
      } catch (guestErr) {
        if (isConnectivityError(guestErr)) {
          triggerBackoff(backoffMsFor(guestErr));
          return;
        }
        console.warn('Failed to replay a queued guest title:', guestErr);
      } finally {
        isFlushingPendingRef.current = false;
      }
      return;
    }

    if (!accessToken || !canPersistCloud) {
      return;
    }

    // Queued REST metadata counts as pending work too: each patch survives a
    // counter reset, so any one of them has to trigger the replay.
    const pendingIconCover = readPendingIconCoverPatch(documentId);
    const pendingMeta = readPendingMetaPatch(owner, documentId);
    if (pendingEditsRef.current <= 0 && !pendingIconCover && !pendingMeta) {
      return;
    }

    if (isInBackoff() || isFlushingPendingRef.current || directSavesInFlightRef.current > 0) {
      return;
    }

    isFlushingPendingRef.current = true;

    try {
      dispatch(setSaving(true));
      dispatch(setError(null));

      // The document may have been born offline: create the cloud row before
      // any update, or the queued edits would 404 and stay stranded.
      const pendingCreate = getPendingCloudCreate(documentId, user?.id ?? null);
      if (pendingCreate) {
        const result = await flushPendingCloudCreate(accessToken, pendingCreate);
        if (result === 'retry') {
          triggerBackoff();
          return;
        }
        if (result === 'dropped') {
          await discardPendingDocument(documentId, { announce: true });
          return;
        }
      }

      // Each patch acknowledges its marker as soon as it lands. Deferring the
      // acknowledgement until every patch succeeded would strand the title's marker
      // when the icon replay fails, even though the title is already in Postgres.

      // A queued title is the only durable copy of an edit that never reached REST.
      // Yjs carries it to collaborators, but lists and search read documents.title,
      // so it is replayed here before the pending badge can clear.
      if (pendingMeta?.title !== undefined) {
        const title = pendingMeta.title;
        try {
          await documentService.updateCloudMetadata(documentId, { title }, accessToken);
          if (readPendingMetaPatch(owner, documentId)?.title === title) {
            clearPendingMetaPatch(owner, documentId, title);
            acknowledgePendingSyncEdits(documentId);
          }
        } catch (titleErr) {
          if (
            titleErr instanceof DocumentServiceApiError &&
            titleErr.status >= 400 &&
            titleErr.status < 500 &&
            titleErr.status !== 401 &&
            // A rate limit is temporary: keep the title and its marker for retry.
            titleErr.status !== 429
          ) {
            console.warn('Dropping a rejected queued title:', titleErr.message);
            if (readPendingMetaPatch(owner, documentId)?.title === title) {
              clearPendingMetaPatch(owner, documentId, title);
              acknowledgePendingSyncEdits(documentId);
            }
          } else {
            throw titleErr;
          }
        }
      }

      // Replay the icon/cover patch through the endpoint that can express a clear.
      // Only the keys this replay carried are removed; a key edited again while the
      // request was in flight remains queued for the next REST submission.
      if (pendingIconCover) {
        try {
          await documentService.updateCloudIconCover(documentId, pendingIconCover, accessToken);
          if (clearPendingIconCoverPatch(documentId, pendingIconCover)) {
            acknowledgePendingSyncEdits(documentId);
          }
        } catch (patchErr) {
          if (
            patchErr instanceof DocumentServiceApiError &&
            patchErr.status >= 400 &&
            patchErr.status < 500 &&
            patchErr.status !== 401 &&
            patchErr.status !== 429
          ) {
            console.warn('Dropping a rejected page icon/cover patch:', patchErr.message);
            if (clearPendingIconCoverPatch(documentId, pendingIconCover)) {
              acknowledgePendingSyncEdits(documentId);
            }
          } else {
            throw patchErr;
          }
        }
      }

      clearBackoff();
      dispatch(setLastSaved(new Date().toISOString()));
    } catch (err) {
      if (isConnectivityError(err)) {
        triggerBackoff(backoffMsFor(err));
        return;
      }

      if (err instanceof DocumentServiceApiError && err.status === 401) {
        // The access token expired while the edits were queued. Keep them
        // pending and re-auth; the new token re-runs this flush.
        void refresh();
        return;
      }

      console.error('Failed to sync pending offline edits:', err);
      dispatch(
        setError(err instanceof Error ? err.message : 'Failed to sync pending offline edits')
      );
    } finally {
      dispatch(setSaving(false));
      isFlushingPendingRef.current = false;
    }
  }, [
    documentId,
    isReadOnly,
    isAuthenticated,
    accessToken,
    user?.id,
    canPersistCloud,
    isOnline,
    dispatch,
    clearBackoff,
    isInBackoff,
    triggerBackoff,
    refresh,
  ]);

  useEffect(() => {
    // A landed sync can queue a legacy title (or leave metadata pending), so it is
    // also a trigger for the REST replay, not just a counter acknowledgement.
    void flushPendingEditsToCloud();
  }, [flushPendingEditsToCloud, pendingEdits, isRealtimeSynced]);

  useEffect(() => {
    if (!ydoc || !hasMeta || isReadOnly) {
      return;
    }

    // Extracted so the pending debounce can be carried out on teardown
    // instead of being dropped when the effect re-runs or the editor unmounts.
    const persistDebouncedChanges = async () => {
      const currentMeta = metaRef.current;

      if (!currentMeta) {
        console.warn('Cannot save: meta is null');
        return;
      }

      const shouldQueuePendingSync = isAuthenticated && canPersistCloud;
      let revisionAtSave = 0;
      let pendingMarkerAtSave = 0;

      directSavesInFlightRef.current += 1;

      try {
        dispatch(setSaving(true));
        dispatch(setError(null));

        // Persist the bytes locally to IndexedDB.
        const localSave = await persistLocalSnapshot({ emit: false });
        revisionAtSave = localSave.revision;
        pendingMarkerAtSave = localSave.pendingMarker;

        // A document created offline has no cloud row yet. Create it before
        // WebSocket or other calls.
        const pendingCreate =
          isAuthenticated && accessToken && canPersistCloud
            ? getPendingCloudCreate(documentId, user?.id ?? null)
            : null;

        if (pendingCreate && accessToken && isOnline && !isInBackoff()) {
          const result = await flushPendingCloudCreate(accessToken, pendingCreate);
          if (result === 'retry') {
            triggerBackoff();
            if (shouldQueuePendingSync) {
              publishPendingMarker(pendingMarkerAtSave);
            }
            return;
          } else if (result === 'dropped') {
            await discardPendingDocument(documentId, { announce: true });
            return;
          }
        }

        if (shouldQueuePendingSync) {
          // A local save is durable, not an acknowledgement from Yhub. The marker is
          // published so the next load prefers the local copy; only a realtime sync
          // (content) or a replayed REST patch (metadata) may clear it.
          publishPendingMarker(pendingMarkerAtSave);
        } else {
          documentService.emitLocalDocumentsChanged();
        }

        dispatch(setLastSaved(new Date().toISOString()));
      } catch (err) {
        // The local snapshot is durable when the pre-save succeeded. Publish
        // its marker so the next load prefers it and the flush can replay it.
        if (revisionAtSave > 0) {
          documentService.emitLocalDocumentsChanged();
          if (shouldQueuePendingSync && pendingMarkerAtSave > 0) {
            publishPendingMarker(pendingMarkerAtSave);
          }
          dispatch(setLastSaved(new Date().toISOString()));
        }

        if (isConnectivityError(err)) {
          triggerBackoff(backoffMsFor(err));
          return;
        }

        if (isUnauthorizedError(err)) {
          void refresh();
          return;
        }

        console.error('Failed to save document:', err);
        dispatch(setError(err instanceof Error ? err.message : 'Failed to save document'));
      } finally {
        directSavesInFlightRef.current = Math.max(0, directSavesInFlightRef.current - 1);
        dispatch(setSaving(false));
      }
    };

    const handleUpdate = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // We debounce saves to avoid excessive IndexedDB writes during rapid edits
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = undefined;
        void persistDebouncedChanges();
      }, SAVE_DEBOUNCE_MS);
    };

    ydoc.on('update', handleUpdate);

    return () => {
      ydoc.off('update', handleUpdate);

      if (saveTimeoutRef.current) {
        // Don't drop the last edits: carry out the pending debounced save now.
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
        void persistDebouncedChanges();
      }
    };
  }, [
    documentId,
    ydoc,
    hasMeta,
    dispatch,
    isAuthenticated,
    accessToken,
    user?.id,
    isOnline,
    isReadOnly,
    canPersistCloud,
    accessLevel,
    clearBackoff,
    isInBackoff,
    triggerBackoff,
    refresh,
    persistLocalSnapshot,
    publishPendingMarker,
  ]);

  // A backgrounded tab can have its timers frozen and be discarded without
  // another chance to run. Persist the debounced edit immediately (locally;
  // the queued marker handles the cloud later) and retry the queue when the
  // page comes back.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const persistPendingLocalSave = () => {
      if (!saveTimeoutRef.current) {
        return;
      }

      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = undefined;

      void persistLocalSnapshot({ emit: true })
        .then(({ revision }) => {
          if (revision > 0) {
            dispatch(setLastSaved(new Date().toISOString()));
          }
        })
        .catch((error) => {
          console.error('Failed to persist document before the page was hidden:', error);
        });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistPendingLocalSave();
        return;
      }

      const pending = readPendingSyncEdits(documentId);
      if (pending > 0) {
        pendingEditsRef.current = pending;
        setPendingEdits(pending);
        void flushPendingEditsToCloud();
      }
    };

    const handlePageHide = () => {
      persistPendingLocalSave();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [documentId, persistLocalSnapshot, flushPendingEditsToCloud, dispatch]);

  return {
    isSaving,
    lastSaved: lastSaved ? new Date(lastSaved) : null,
    pendingEdits,
    hasPendingSync: pendingEdits > 0,
  };
}
