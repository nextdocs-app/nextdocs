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
  clearPendingIconCoverPatch,
  clearPendingSyncEdits,
  markPendingSyncEdits,
  PENDING_SYNC_EVENT,
  readPendingIconCoverPatch,
  readPendingSyncEdits,
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
  accessLevel?: DocumentAccessLevel | null
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
    pendingEditsRef.current = nextPending;
    setPendingEdits(nextPending);
  }, [documentId]);

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
      const linkOrigin =
        !isAuthenticated && documentService.isPublicLinkDocument(documentId)
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

      const nextPendingEdits = readPendingSyncEdits(documentId) + 1;
      const pendingMarker = options.publishPending
        ? writePendingSyncEdits(documentId, nextPendingEdits)
        : markPendingSyncEdits(documentId, nextPendingEdits);

      if (options.publishPending) {
        pendingEditsRef.current = pendingMarker;
        setPendingEdits(pendingMarker);
      }

      return { revision, pendingMarker };
    },
    [documentId, ydoc, isReadOnly, isAuthenticated, canPersistCloud, reconcileSavedMeta]
  );

  const flushPendingEditsToCloud = useCallback(async () => {
    if (isReadOnly || !isAuthenticated || !accessToken || !canPersistCloud || !isOnline) {
      return;
    }

    // A queued icon/cover patch counts as pending work too: it is bumped with the
    // counter, but treating either one as the trigger keeps a clear from being
    // stranded if the counter is ever reset while the patch survives.
    const pendingIconCover = readPendingIconCoverPatch(documentId);
    if (pendingEditsRef.current <= 0 && !pendingIconCover) {
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

      // Replay the icon/cover patch through the endpoint that can express a clear.
      if (pendingIconCover) {
        try {
          await documentService.updateCloudIconCover(documentId, pendingIconCover, accessToken);
        } catch (patchErr) {
          if (
            patchErr instanceof DocumentServiceApiError &&
            patchErr.status >= 400 &&
            patchErr.status < 500 &&
            patchErr.status !== 401
          ) {
            console.warn('Dropping a rejected page icon/cover patch:', patchErr.message);
          } else {
            throw patchErr;
          }
        }
        clearPendingIconCoverPatch(documentId);
      }

      clearPendingSyncEdits(documentId);
      pendingEditsRef.current = 0;
      setPendingEdits(0);
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
    void flushPendingEditsToCloud();
  }, [flushPendingEditsToCloud, pendingEdits]);

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
              const published = writePendingSyncEdits(documentId, pendingMarkerAtSave);
              pendingEditsRef.current = published;
              setPendingEdits(published);
            }
            return;
          } else if (result === 'dropped') {
            await discardPendingDocument(documentId, { announce: true });
            return;
          }
        }

        if (!isOnline && shouldQueuePendingSync) {
          const published = writePendingSyncEdits(documentId, pendingMarkerAtSave);
          pendingEditsRef.current = published;
          setPendingEdits(published);
        } else if (shouldQueuePendingSync) {
          clearPendingSyncEdits(documentId);
          pendingEditsRef.current = 0;
          setPendingEdits(0);
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
            const published = writePendingSyncEdits(documentId, pendingMarkerAtSave);
            pendingEditsRef.current = published;
            setPendingEdits(published);
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
