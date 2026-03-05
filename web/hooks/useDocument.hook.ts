import { useEffect, useCallback, useState } from 'react';
import { documentService } from '@/services/document.service';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  setCurrentDocument,
  setLoading,
  setError,
  updateMeta as updateMetaAction,
} from '@/stores/document/document.slice';
import { setYDoc } from '@/stores/document/ydoc-holder';
import type { DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';

const DEFAULT_DOC_ID = 'default-doc';

export function useDocument(documentId?: string) {
  const id = documentId || DEFAULT_DOC_ID;
  const dispatch = useAppDispatch();
  const { meta, isLoading, error } = useAppSelector((state) => state.document);

  // Track ydoc in local state so the component re-renders
  // when a new document is loaded (instead of reading from
  // the module-level singleton at render time, which may be stale)
  const [ydoc, setLocalYDoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDoc() {
      try {
        dispatch(setLoading(true));
        dispatch(setError(null));

        const result = await documentService.getOrCreateDocument(id);

        if (!cancelled) {
          setYDoc(result.ydoc);
          setLocalYDoc(result.ydoc);
          dispatch(
            setCurrentDocument({
              id,
              meta: result.meta,
            })
          );
        }
      } catch (err) {
        console.error('Failed to load document:', err);

        if (!cancelled) {
          dispatch(setError(err instanceof Error ? err.message : 'Failed to load document'));
        }
      } finally {
        if (!cancelled) {
          dispatch(setLoading(false));
        }
      }
    }

    // Clear stale ydoc immediately so the editor shows loading state
    setLocalYDoc(null);
    loadDoc();

    return () => {
      cancelled = true;
    };
  }, [id, dispatch]);

  const updateMeta = useCallback(
    (updates: Partial<DocumentMeta>) => {
      if (!meta) {
        console.warn('Cannot update meta: meta is null');
        return;
      }

      const previousMeta = { ...meta };
      const updatedAt = new Date().toISOString();
      const updatedMeta = { ...meta, ...updates, updatedAt };

      dispatch(updateMetaAction({ ...updates, updatedAt }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('document-meta-updated', {
            detail: { id, meta: updatedMeta },
          })
        );
      }

      documentService.updateMetadata(id, updates).catch((err) => {
        console.error('Failed to persist metadata update:', err);
        dispatch(updateMetaAction({ ...previousMeta, updatedAt: previousMeta.updatedAt }));
      });
    },
    [meta, id, dispatch]
  );

  return {
    ydoc,
    meta,
    isLoading,
    error: error ? new Error(error) : null,
    updateMeta,
  };
}
