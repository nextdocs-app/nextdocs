import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { documentService } from '@/services/document.service';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { useAuth } from '@/hooks/useAuth.hook';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { useCloudBackoff } from '@/hooks/useCloudBackoff.hook';
import {
  setSaving,
  setLastSaved,
  setError,
  setCurrentDocument,
} from '@/stores/document/document.slice';
import type { DocumentMeta } from '@/types/document.types';
import {
  clearPendingSyncEdits,
  incrementPendingSyncEdits,
  PENDING_SYNC_EVENT,
  readPendingSyncEdits,
} from '@/lib/offline-sync.util';
import { CLOUD_BACKOFF_MS, isConnectivityError } from '@/lib/cloud-connectivity.util';

const SAVE_DEBOUNCE_MS = 500;

export function useYjsPersistence(
  documentId: string,
  ydoc: Y.Doc | null,
  meta: DocumentMeta | null,
  isReadOnly = false,
  canPersistCloud = true
) {
  const dispatch = useAppDispatch();
  const { isSaving, lastSaved } = useAppSelector((state) => state.document);
  const { isAuthenticated, accessToken } = useAuth();
  const { isOnline } = useNetworkStatus();
  const { trigger: triggerBackoff, clear: clearBackoff, isInBackoff } = useCloudBackoff();

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isFlushingPendingRef = useRef(false);
  const [pendingEdits, setPendingEdits] = useState(() => readPendingSyncEdits(documentId));
  const pendingEditsRef = useRef(pendingEdits);

  // We use a ref to avoid recreating the timeout handler when meta changes
  const metaRef = useRef(meta);

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

    if (pendingEditsRef.current <= 0) {
      return;
    }

    if (isInBackoff() || isFlushingPendingRef.current) {
      return;
    }

    isFlushingPendingRef.current = true;

    try {
      dispatch(setSaving(true));
      dispatch(setError(null));

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
      });
      dispatch(
        setCurrentDocument({
          id: documentId,
          meta: sourceMeta,
        })
      );

      clearPendingSyncEdits(documentId);
      pendingEditsRef.current = 0;
      setPendingEdits(0);
      clearBackoff();
      dispatch(setLastSaved(new Date().toISOString()));
    } catch (err) {
      if (isConnectivityError(err)) {
        triggerBackoff(CLOUD_BACKOFF_MS);
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
    canPersistCloud,
    isOnline,
    dispatch,
    clearBackoff,
    isInBackoff,
    triggerBackoff,
  ]);

  useEffect(() => {
    void flushPendingEditsToCloud();
  }, [flushPendingEditsToCloud, pendingEdits]);

  useEffect(() => {
    if (!ydoc || !meta || isReadOnly) {
      return;
    }

    const handleUpdate = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // We debounce saves to avoid excessive IndexedDB writes during rapid edits
      saveTimeoutRef.current = setTimeout(async () => {
        const currentMeta = metaRef.current;

        if (!currentMeta) {
          console.warn('Cannot save: meta is null');
          return;
        }

        const savedMeta = {
          ...currentMeta,
          updatedAt: new Date().toISOString(),
        };

        const persistLocalCopy = async () => {
          await documentService.saveDocument(documentId, ydoc, savedMeta);
          documentService.emitLocalDocumentsChanged();
          dispatch(
            setCurrentDocument({
              id: documentId,
              meta: savedMeta,
            })
          );
        };

        try {
          dispatch(setSaving(true));
          dispatch(setError(null));

          const canAttemptCloudSave =
            isAuthenticated && accessToken && canPersistCloud && isOnline && !isInBackoff();
          const shouldQueuePendingSync = isAuthenticated && !!accessToken && canPersistCloud;

          if (canAttemptCloudSave) {
            await documentService.saveCloudDocument(documentId, ydoc, currentMeta, accessToken);
            try {
              await documentService.saveDocument(documentId, ydoc, currentMeta, {
                touchUpdatedAt: false,
              });
            } catch (cacheErr) {
              console.warn('Failed to mirror cloud save into local cache:', cacheErr);
            }
            dispatch(
              setCurrentDocument({
                id: documentId,
                meta: savedMeta,
              })
            );
            clearBackoff();
            clearPendingSyncEdits(documentId);
            pendingEditsRef.current = 0;
            setPendingEdits(0);
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
          if (isAuthenticated && accessToken && canPersistCloud && isConnectivityError(err)) {
            triggerBackoff(CLOUD_BACKOFF_MS);

            try {
              await persistLocalCopy();
              const nextPendingEdits = incrementPendingSyncEdits(documentId);
              pendingEditsRef.current = nextPendingEdits;
              setPendingEdits(nextPendingEdits);
              dispatch(setLastSaved(new Date().toISOString()));
              return;
            } catch (fallbackErr) {
              console.error('Failed to save document:', fallbackErr);
              dispatch(
                setError(
                  fallbackErr instanceof Error ? fallbackErr.message : 'Failed to save document'
                )
              );
              return;
            }
          }

          console.error('Failed to save document:', err);
          dispatch(setError(err instanceof Error ? err.message : 'Failed to save document'));
        } finally {
          dispatch(setSaving(false));
        }
      }, SAVE_DEBOUNCE_MS);
    };

    ydoc.on('update', handleUpdate);

    return () => {
      ydoc.off('update', handleUpdate);

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    documentId,
    ydoc,
    meta,
    dispatch,
    isAuthenticated,
    accessToken,
    isOnline,
    isReadOnly,
    canPersistCloud,
    clearBackoff,
    isInBackoff,
    triggerBackoff,
  ]);

  return {
    isSaving,
    lastSaved: lastSaved ? new Date(lastSaved) : null,
    pendingEdits,
    hasPendingSync: pendingEdits > 0,
  };
}
