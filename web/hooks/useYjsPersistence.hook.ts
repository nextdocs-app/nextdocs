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
  incrementPendingSyncEdits,
  PENDING_SYNC_EVENT,
  readPendingIconCoverPatch,
  readPendingSyncEdits,
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

    if (isInBackoff() || isFlushingPendingRef.current) {
      return;
    }

    isFlushingPendingRef.current = true;

    try {
      dispatch(setSaving(true));
      dispatch(setError(null));

      // The document may have been born offline: create the cloud row before
      // any PATCH, or the queued edits would 404 and stay stranded.
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

      // Prefer the locally cached snapshot during reconnect to avoid syncing stale in-memory state.
      const localSnapshot = await documentService.loadDocument(documentId);
      const sourceYDoc = localSnapshot?.ydoc ?? ydoc;
      const sourceMeta = localSnapshot?.meta ?? metaRef.current;

      if (!sourceYDoc || !sourceMeta) {
        return;
      }

      await documentService.saveCloudDocument(documentId, sourceYDoc, sourceMeta, accessToken);
      await documentService.saveDocument(documentId, sourceYDoc, sourceMeta, {
        touchUpdatedAt: false,
        // A cloud save proves account ownership; a prior guest mirror of the
        // same id must not keep hiding the document from Private listings.
        origin: 'local',
      });
      reconcileSavedMeta(sourceMeta);

      // Replay the icon/cover patch through the endpoint that can express a clear.
      // The content save above omits a cleared icon — the API reads that as "leave
      // unchanged" — so without this an offline Remove is undone on the next load.
      if (pendingIconCover) {
        try {
          await documentService.updateCloudIconCover(documentId, pendingIconCover, accessToken);
        } catch (patchErr) {
          if (
            patchErr instanceof DocumentServiceApiError &&
            patchErr.status >= 400 &&
            patchErr.status < 500 &&
            // 401 means the token expired, not that the server refused the
            // patch. Keep it queued so the refreshed session can replay it.
            patchErr.status !== 401
          ) {
            // The server will refuse this again, and a queued patch keeps the
            // document pinned to its local copy (a pending sync forces local
            // reads), so drop it rather than retry it forever.
            console.warn('Dropping a rejected page icon/cover patch:', patchErr.message);
          } else {
            // Connectivity or auth: leave the patch queued for the next flush.
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
    ydoc,
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
    reconcileSavedMeta,
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

      const savedMeta = {
        ...currentMeta,
        updatedAt: new Date().toISOString(),
      };

      // Bytes that arrived via an anonymous share link keep their provenance
      // in the local cache so Private listings never claim them as owned.
      const linkOrigin =
        !isAuthenticated && documentService.isPublicLinkDocument(documentId)
          ? ({ origin: 'public-link' } as const)
          : undefined;

      const persistLocalCopy = async () => {
        await documentService.saveDocument(
          documentId,
          ydoc,
          savedMeta,
          linkOrigin ? { origin: linkOrigin.origin } : undefined
        );
        documentService.emitLocalDocumentsChanged();
        reconcileSavedMeta(savedMeta);
      };

      try {
        dispatch(setSaving(true));
        dispatch(setError(null));

        // A document created offline has no cloud row yet. Create it before the
        // PATCH below, which would otherwise 404 and strand the edit.
        const pendingCreate =
          isAuthenticated && accessToken && canPersistCloud
            ? getPendingCloudCreate(documentId, user?.id ?? null)
            : null;
        let cloudRowReady = pendingCreate === null;

        if (pendingCreate && accessToken && isOnline && !isInBackoff()) {
          const result = await flushPendingCloudCreate(accessToken, pendingCreate);
          if (result === 'created') {
            cloudRowReady = true;
          } else if (result === 'retry') {
            triggerBackoff();
          } else {
            // The server refused the create. Keeping the copy and its pending
            // counter would pin the editor to a cloud row that cannot exist.
            await discardPendingDocument(documentId, { announce: true });
            return;
          }
        }

        const canAttemptCloudSave =
          isAuthenticated &&
          accessToken &&
          canPersistCloud &&
          isOnline &&
          !isInBackoff() &&
          cloudRowReady;
        // Anonymous share-link editors persist snapshots through the public
        // endpoint (the link is the capability). View/comment links stay
        // read-only via isReadOnly, and explicit EDIT/OWNER accessLevel gate
        // prevents unexpected write attempts from guests without edit rights.
        // Local-only guest docs (never opened via a share link) must not hit
        // the public endpoint: mirror updateMeta's link gate so doomed
        // 404 PUTs don't spend the shared per-IP budget.
        const canPublicEdit = accessLevel === 'EDIT' || accessLevel === 'OWNER';
        const isKnownPublicLink = documentService.isPublicLinkDocument(documentId);
        const canAttemptPublicSave =
          !isAuthenticated &&
          canPersistCloud &&
          isOnline &&
          !isInBackoff() &&
          canPublicEdit &&
          isKnownPublicLink;
        const shouldQueuePendingSync = isAuthenticated && !!accessToken && canPersistCloud;

        if (canAttemptCloudSave) {
          await documentService.saveCloudDocument(documentId, ydoc, currentMeta, accessToken);
          try {
            await documentService.saveDocument(documentId, ydoc, currentMeta, {
              touchUpdatedAt: false,
              origin: 'local',
            });
          } catch (cacheErr) {
            console.warn('Failed to mirror cloud save into local cache:', cacheErr);
          }
          reconcileSavedMeta(savedMeta);
          clearBackoff();
          clearPendingSyncEdits(documentId);
          pendingEditsRef.current = 0;
          setPendingEdits(0);
        } else if (canAttemptPublicSave) {
          try {
            await documentService.savePublicDocument(documentId, ydoc, currentMeta);
            try {
              await documentService.saveDocument(documentId, ydoc, currentMeta, {
                touchUpdatedAt: false,
                // A successful public save proves link provenance.
                origin: 'public-link',
              });
              documentService.notePublicLinkDocument(documentId);
            } catch (cacheErr) {
              console.warn('Failed to mirror public save into local cache:', cacheErr);
            }
            reconcileSavedMeta(savedMeta);
            clearBackoff();
          } catch (publicErr) {
            if (isConnectivityError(publicErr)) {
              triggerBackoff(backoffMsFor(publicErr));
            }
            // A 403/404 here means the link was revoked or downgraded; keep
            // the local copy and let access revalidation surface it.
            await persistLocalCopy();
          }
        } else {
          // Comment-only access, browser offline, or cloud-save backoff path.
          await persistLocalCopy();
          if (shouldQueuePendingSync) {
            const nextPendingEdits = incrementPendingSyncEdits(documentId);
            pendingEditsRef.current = nextPendingEdits;
            setPendingEdits(nextPendingEdits);
          }
        }

        dispatch(setLastSaved(new Date().toISOString()));
      } catch (err) {
        if (
          isAuthenticated &&
          accessToken &&
          canPersistCloud &&
          (isConnectivityError(err) || isUnauthorizedError(err))
        ) {
          if (isConnectivityError(err)) {
            triggerBackoff(backoffMsFor(err));
          }

          try {
            await persistLocalCopy();
            const nextPendingEdits = incrementPendingSyncEdits(documentId);
            pendingEditsRef.current = nextPendingEdits;
            setPendingEdits(nextPendingEdits);
            dispatch(setLastSaved(new Date().toISOString()));
          } catch (fallbackErr) {
            console.error('Failed to save document:', fallbackErr);
            dispatch(
              setError(
                fallbackErr instanceof Error ? fallbackErr.message : 'Failed to save document'
              )
            );
          }

          if (isUnauthorizedError(err)) {
            // The token expired between the debounce and the request. Keep the
            // bytes queued so the refresh can replay them instead of dropping
            // the edit.
            void refresh();
          }
          return;
        }

        console.error('Failed to save document:', err);
        dispatch(setError(err instanceof Error ? err.message : 'Failed to save document'));
      } finally {
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
    reconcileSavedMeta,
    refresh,
  ]);

  return {
    isSaving,
    lastSaved: lastSaved ? new Date(lastSaved) : null,
    pendingEdits,
    hasPendingSync: pendingEdits > 0,
  };
}
