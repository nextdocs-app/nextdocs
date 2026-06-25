'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { useAuth } from '@/hooks/useAuth.hook';
import { useCloudBackoff } from '@/hooks/useCloudBackoff.hook';
import type { DocumentMeta } from '@/types/document.types';
import { combineSharedDocuments } from '@/stores/documentList/documentList.utils';
import type {
  LocalDocumentEntry,
  SharedDocumentEntry,
} from '@/stores/documentList/documentList.types';
import {
  fetchDocumentsThunk,
  fetchSharedDocumentsThunk,
  fetchTrashDocumentsThunk,
  loadMoreDocumentsThunk,
  loadMoreSharedDocumentsThunk,
  loadMoreTrashDocumentsThunk,
  updateDocumentMeta,
  resetOnAuthTransition,
  setShowingAll,
  setShowingAllShared,
} from '@/stores/documentList/documentList.slice';

export type { LocalDocumentEntry, SharedDocumentEntry };

export function useDocumentList() {
  const dispatch = useAppDispatch();
  const { isAuthenticated, accessToken, isInitializing, refresh: refreshSession } = useAuth();

  const { trigger: triggerCloudBackoff, clear: clearCloudBackoff, isInBackoff } = useCloudBackoff();

  const prevIsAuthenticatedRef = useRef<boolean | null>(null);
  const cacheSyncInFlightRef = useRef<Set<string>>(new Set());

  const {
    documents,
    sharedWithMeDocuments,
    ownerSharedDocuments,
    trashedDocuments,
    isLoading,
    isLoadingMore,
    hasMore,
    isShowingAll,
    isTrashLoading,
    isSharedLoading,
    isSharedLoadingMore,
    sharedWithMeHasMore,
    ownerSharedHasMore,
    isShowingAllShared,
    isTrashLoadingMore,
    trashHasMore,
  } = useAppSelector((state) => state.documentList);

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    const isAuthTransition =
      prevIsAuthenticatedRef.current !== null && prevIsAuthenticatedRef.current !== isAuthenticated;

    if (isAuthTransition) {
      dispatch(resetOnAuthTransition({ isAuthenticated }));
    }

    prevIsAuthenticatedRef.current = isAuthenticated;

    void dispatch(
      fetchDocumentsThunk({
        showLoading: true,
        keepExpanded: false,
        isCloudUnavailable: isInBackoff(),
        cacheSyncInFlight: cacheSyncInFlightRef.current,
      })
    ).then((result) => {
      if (fetchDocumentsThunk.fulfilled.match(result)) {
        if (result.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else if (result.payload.errorType === 'unauthorized') {
          refreshSession();
        } else {
          clearCloudBackoff();
        }
      }
    });
  }, [
    isInitializing,
    isAuthenticated,
    dispatch,
    isInBackoff,
    triggerCloudBackoff,
    clearCloudBackoff,
    refreshSession,
  ]);

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    if (!isAuthenticated || !accessToken) {
      return;
    }

    if (isInBackoff()) {
      return;
    }

    void dispatch(
      fetchSharedDocumentsThunk({
        showLoading: true,
        isCloudUnavailable: isInBackoff(),
        cacheSyncInFlight: cacheSyncInFlightRef.current,
      })
    ).then((result) => {
      if (fetchSharedDocumentsThunk.fulfilled.match(result)) {
        if (result.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else if (result.payload.errorType === 'unauthorized') {
          refreshSession();
        } else {
          clearCloudBackoff();
        }
      }
    });
  }, [
    isInitializing,
    isAuthenticated,
    accessToken,
    dispatch,
    isInBackoff,
    triggerCloudBackoff,
    clearCloudBackoff,
    refreshSession,
  ]);

  const refresh = useCallback(
    async (showLoading = true) => {
      const isCloudUnavailable = isInBackoff();
      const res = await dispatch(
        fetchDocumentsThunk({
          showLoading,
          keepExpanded: true,
          isCloudUnavailable,
          cacheSyncInFlight: cacheSyncInFlightRef.current,
        })
      );
      if (fetchDocumentsThunk.fulfilled.match(res)) {
        if (res.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else {
          clearCloudBackoff();
        }
      }

      if (!isAuthenticated || !accessToken) {
        return;
      }

      if (isCloudUnavailable) {
        return;
      }

      const sharedRes = await dispatch(
        fetchSharedDocumentsThunk({
          showLoading,
          isCloudUnavailable,
          cacheSyncInFlight: cacheSyncInFlightRef.current,
        })
      );
      if (fetchSharedDocumentsThunk.fulfilled.match(sharedRes)) {
        if (sharedRes.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else if (sharedRes.payload.errorType !== 'unauthorized') {
          clearCloudBackoff();
        }
      }
    },
    [dispatch, isAuthenticated, accessToken, isInBackoff, triggerCloudBackoff, clearCloudBackoff]
  );

  const refreshTrash = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        const res = await dispatch(
          fetchTrashDocumentsThunk({
            isCloudUnavailable: isInBackoff(),
          })
        );
        if (fetchTrashDocumentsThunk.fulfilled.match(res)) {
          if (res.payload.errorType === 'connectivity_error') {
            triggerCloudBackoff();
          } else {
            clearCloudBackoff();
          }
        }
        return;
      }

      if (!isAuthenticated || !accessToken || isInBackoff()) {
        return;
      }

      const res = await dispatch(
        fetchTrashDocumentsThunk({
          isCloudUnavailable: false,
        })
      );
      if (fetchTrashDocumentsThunk.fulfilled.match(res)) {
        if (res.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else {
          clearCloudBackoff();
        }
      }
    },
    [dispatch, isAuthenticated, accessToken, isInBackoff, triggerCloudBackoff, clearCloudBackoff]
  );

  const showAllDocuments = useCallback(() => {
    if (isShowingAll) {
      return;
    }
    dispatch(setShowingAll(true));
    void dispatch(
      fetchDocumentsThunk({
        showLoading: false,
        keepExpanded: true,
        isCloudUnavailable: isInBackoff(),
        cacheSyncInFlight: cacheSyncInFlightRef.current,
      })
    ).then((res) => {
      if (fetchDocumentsThunk.fulfilled.match(res)) {
        if (res.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else {
          clearCloudBackoff();
        }
      }
    });
  }, [dispatch, isShowingAll, isInBackoff, triggerCloudBackoff, clearCloudBackoff]);

  const showAllSharedDocuments = useCallback(() => {
    if (isShowingAllShared) {
      return;
    }
    dispatch(setShowingAllShared(true));
    if (!isAuthenticated || !accessToken || isInBackoff()) {
      return;
    }

    if (!isShowingAll) {
      showAllDocuments();
    }

    void dispatch(
      fetchSharedDocumentsThunk({
        showLoading: false,
        isCloudUnavailable: false,
        cacheSyncInFlight: cacheSyncInFlightRef.current,
      })
    ).then((res) => {
      if (fetchSharedDocumentsThunk.fulfilled.match(res)) {
        if (res.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else if (res.payload.errorType !== 'unauthorized') {
          clearCloudBackoff();
        }
      }
    });
  }, [
    dispatch,
    isAuthenticated,
    accessToken,
    isShowingAll,
    isShowingAllShared,
    showAllDocuments,
    isInBackoff,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  const showTrashDocuments = useCallback(async () => {
    const res = await dispatch(
      fetchTrashDocumentsThunk({
        isCloudUnavailable: isInBackoff(),
      })
    );
    if (fetchTrashDocumentsThunk.fulfilled.match(res)) {
      if (res.payload.errorType === 'connectivity_error') {
        triggerCloudBackoff();
      } else {
        clearCloudBackoff();
      }
    }
  }, [dispatch, isInBackoff, triggerCloudBackoff, clearCloudBackoff]);

  const loadMore = useCallback(async () => {
    const res = await dispatch(
      loadMoreDocumentsThunk({
        isCloudUnavailable: isInBackoff(),
        cacheSyncInFlight: cacheSyncInFlightRef.current,
      })
    );
    if (loadMoreDocumentsThunk.fulfilled.match(res)) {
      if (res.payload.errorType === 'connectivity_error') {
        triggerCloudBackoff();
      } else {
        clearCloudBackoff();
      }
    }
  }, [dispatch, isInBackoff, triggerCloudBackoff, clearCloudBackoff]);

  const loadMoreSharedDocuments = useCallback(async () => {
    const isCloudUnavailable = isInBackoff();
    if (sharedWithMeHasMore) {
      const res = await dispatch(
        loadMoreSharedDocumentsThunk({
          isCloudUnavailable,
          cacheSyncInFlight: cacheSyncInFlightRef.current,
        })
      );
      if (loadMoreSharedDocumentsThunk.fulfilled.match(res)) {
        if (res.payload.errorType === 'connectivity_error') {
          triggerCloudBackoff();
        } else {
          clearCloudBackoff();
        }
      }
    }

    if (ownerSharedHasMore) {
      if (!isShowingAll) {
        showAllDocuments();
      }
      await loadMore();
    }
  }, [
    dispatch,
    sharedWithMeHasMore,
    ownerSharedHasMore,
    isShowingAll,
    showAllDocuments,
    loadMore,
    isInBackoff,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  const loadMoreTrashDocuments = useCallback(async () => {
    const res = await dispatch(
      loadMoreTrashDocumentsThunk({
        isCloudUnavailable: isInBackoff(),
      })
    );
    if (loadMoreTrashDocumentsThunk.fulfilled.match(res)) {
      if (res.payload.errorType === 'connectivity_error') {
        triggerCloudBackoff();
      } else {
        clearCloudBackoff();
      }
    }
  }, [dispatch, isInBackoff, triggerCloudBackoff, clearCloudBackoff]);

  useEffect(() => {
    const handleMetaUpdated = (event: CustomEvent<{ id: string; meta: DocumentMeta }>) => {
      dispatch(updateDocumentMeta(event.detail));
    };

    window.addEventListener('document-meta-updated', handleMetaUpdated as EventListener);
    return () => {
      window.removeEventListener('document-meta-updated', handleMetaUpdated as EventListener);
    };
  }, [dispatch]);

  useEffect(() => {
    const handleDocsChanged = () => {
      void refresh(false);
      if (trashedDocuments.length > 0) {
        void refreshTrash(false);
      }
    };

    window.addEventListener('local-documents-changed', handleDocsChanged);
    window.addEventListener('cloud-documents-changed', handleDocsChanged);

    return () => {
      window.removeEventListener('local-documents-changed', handleDocsChanged);
      window.removeEventListener('cloud-documents-changed', handleDocsChanged);
    };
  }, [refresh, refreshTrash, trashedDocuments.length]);

  return {
    documents,
    sharedDocuments: combineSharedDocuments(sharedWithMeDocuments, ownerSharedDocuments),
    trashedDocuments,
    isLoading,
    isLoadingMore,
    hasMore,
    isShowingAll,
    isTrashLoading,
    isSharedLoading,
    isSharedLoadingMore,
    sharedHasMore: sharedWithMeHasMore || ownerSharedHasMore,
    isShowingAllShared,
    isTrashLoadingMore,
    trashHasMore,
    canShowAll: !isShowingAll && hasMore,
    refresh,
    refreshTrash,
    showAllDocuments,
    showAllSharedDocuments,
    showTrashDocuments,
    loadMore,
    loadMoreSharedDocuments,
    loadMoreTrashDocuments,
  };
}
