'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import { useAuth } from '@/hooks/useAuth.hook';
import { useCloudBackoff } from '@/hooks/useCloudBackoff.hook';
import { isConnectivityError } from '@/lib/cloud-connectivity.util';
import { toSortableTimestamp } from '@/lib/timestamp.util';
import type { DocumentMeta } from '@/types/document.types';

export interface LocalDocumentEntry {
  id: string;
  meta: DocumentMeta;
}

export interface SharedDocumentEntry extends LocalDocumentEntry {
  relationship: 'owner' | 'collaborator';
}

const INITIAL_DOCS_COUNT = 7;
const PAGE_SIZE = 20;
const COLLABORATOR_CHECK_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        break;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function sortByUpdatedAtDesc<T extends LocalDocumentEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => toSortableTimestamp(b.meta.updatedAt) - toSortableTimestamp(a.meta.updatedAt)
  );
}

function mergeUniqueDocuments<T extends LocalDocumentEntry>(base: T[], incoming: T[]): T[] {
  if (incoming.length === 0) {
    return base;
  }

  const byId = new Map(base.map((doc) => [doc.id, doc]));
  incoming.forEach((doc) => {
    byId.set(doc.id, doc);
  });

  return sortByUpdatedAtDesc(Array.from(byId.values()));
}

function updateDocumentMetaInList<T extends LocalDocumentEntry>(
  entries: T[],
  id: string,
  meta: DocumentMeta
): { entries: T[]; exists: boolean } {
  const exists = entries.some((doc) => doc.id === id);

  if (!exists) {
    return { entries, exists: false };
  }

  return {
    entries: sortByUpdatedAtDesc(entries.map((doc) => (doc.id === id ? { ...doc, meta } : doc))),
    exists: true,
  };
}

function combineSharedDocuments(
  sharedWithMeDocuments: SharedDocumentEntry[],
  ownerSharedDocuments: SharedDocumentEntry[]
): SharedDocumentEntry[] {
  return mergeUniqueDocuments(sharedWithMeDocuments, ownerSharedDocuments);
}

export function useDocumentList() {
  const [documents, setDocuments] = useState<LocalDocumentEntry[]>([]);
  const [sharedWithMeDocuments, setSharedWithMeDocuments] = useState<SharedDocumentEntry[]>([]);
  const [ownerSharedDocuments, setOwnerSharedDocuments] = useState<SharedDocumentEntry[]>([]);
  const [trashedDocuments, setTrashedDocuments] = useState<LocalDocumentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isShowingAll, setIsShowingAll] = useState(false);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  const [isSharedLoading, setIsSharedLoading] = useState(true);
  const [isSharedLoadingMore, setIsSharedLoadingMore] = useState(false);
  const [sharedWithMeHasMore, setSharedWithMeHasMore] = useState(false);
  const [ownerSharedHasMore, setOwnerSharedHasMore] = useState(false);
  const [isShowingAllShared, setIsShowingAllShared] = useState(false);
  const [isTrashLoadingMore, setIsTrashLoadingMore] = useState(false);
  const [trashHasMore, setTrashHasMore] = useState(false);
  const { isAuthenticated, accessToken, isInitializing, refresh: refreshSession } = useAuth();
  // Track previous auth state to detect boundary transitions (guest ↔ authenticated).
  const prevIsAuthenticatedRef = useRef<boolean | null>(null);
  // Stable ref so refreshSession can be called from inside callbacks without being a dep.
  const refreshRef = useRef(refreshSession);
  useEffect(() => {
    refreshRef.current = refreshSession;
  }, [refreshSession]);

  const nextCloudPageRef = useRef(0);
  const nextSharedPageRef = useRef(0);
  const nextTrashCloudPageRef = useRef(0);
  const localAllDocsRef = useRef<LocalDocumentEntry[]>([]);
  const localLoadedCountRef = useRef(0);
  const documentsRef = useRef<LocalDocumentEntry[]>([]);
  const sharedWithMeDocumentsRef = useRef<SharedDocumentEntry[]>([]);
  const ownerSharedDocumentsRef = useRef<SharedDocumentEntry[]>([]);
  const isShowingAllRef = useRef(false);
  const isShowingAllSharedRef = useRef(false);
  const trashedCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const cacheSyncInFlightRef = useRef<Set<string>>(new Set());
  const {
    isInBackoff: isCloudUnavailable,
    trigger: triggerCloudBackoff,
    clear: clearCloudBackoff,
  } = useCloudBackoff();

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    sharedWithMeDocumentsRef.current = sharedWithMeDocuments;
  }, [sharedWithMeDocuments]);

  useEffect(() => {
    ownerSharedDocumentsRef.current = ownerSharedDocuments;
  }, [ownerSharedDocuments]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isShowingAllRef.current = isShowingAll;
  }, [isShowingAll]);

  useEffect(() => {
    isShowingAllSharedRef.current = isShowingAllShared;
  }, [isShowingAllShared]);

  useEffect(() => {
    trashedCountRef.current = trashedDocuments.length;
  }, [trashedDocuments.length]);

  const classifyOwnedDocuments = useCallback(
    async (
      docs: LocalDocumentEntry[]
    ): Promise<{ privateDocs: LocalDocumentEntry[]; sharedByOwnerDocs: SharedDocumentEntry[] }> => {
      if (!isAuthenticated || !accessToken || docs.length === 0) {
        return { privateDocs: docs, sharedByOwnerDocs: [] };
      }

      const checks = await mapWithConcurrency(docs, COLLABORATOR_CHECK_CONCURRENCY, async (doc) => {
        try {
          const collaborators = await documentService.listCollaborators(doc.id, accessToken);
          const hasExtraUser = collaborators.some(
            (collaborator) => collaborator.accessLevel !== 'OWNER'
          );
          return { doc, hasExtraUser };
        } catch (error) {
          console.warn(`Failed to resolve collaborators for document ${doc.id}:`, error);
          return { doc, hasExtraUser: false };
        }
      });

      return {
        privateDocs: checks.filter((entry) => !entry.hasExtraUser).map((entry) => entry.doc),
        sharedByOwnerDocs: checks
          .filter((entry) => entry.hasExtraUser)
          .map((entry) => ({ ...entry.doc, relationship: 'owner' })),
      };
    },
    [isAuthenticated, accessToken]
  );

  const ensureCloudDocsCachedLocally = useCallback(
    async (docs: { id: string; meta: DocumentMeta }[]) => {
      if (!isAuthenticated || !accessToken || docs.length === 0 || isCloudUnavailable()) {
        return;
      }

      let localMetaEntries: { id: string; meta: DocumentMeta }[] = [];
      try {
        localMetaEntries = await documentService.getAllDocumentsMeta();
      } catch (error) {
        console.warn('Failed to read local documents for cache sync:', error);
      }

      const localUpdatedAtById = new Map(
        localMetaEntries.map((entry) => [entry.id, toSortableTimestamp(entry.meta.updatedAt)])
      );

      const docsToCache = docs.filter((doc) => {
        const localUpdatedAt = localUpdatedAtById.get(doc.id);
        if (localUpdatedAt == null) {
          return true;
        }

        return localUpdatedAt < toSortableTimestamp(doc.meta.updatedAt);
      });

      const CACHE_SYNC_CONCURRENCY = 4;

      await mapWithConcurrency(docsToCache, CACHE_SYNC_CONCURRENCY, async (doc) => {
        const flightKey = `${doc.id}:${doc.meta.updatedAt}`;
        if (cacheSyncInFlightRef.current.has(flightKey)) {
          return;
        }

        cacheSyncInFlightRef.current.add(flightKey);

        try {
          const cloudDoc = await documentService.getCloudDocument(doc.id, accessToken);
          await documentService.saveDocument(doc.id, cloudDoc.ydoc, cloudDoc.meta, {
            touchUpdatedAt: false,
          });
        } catch (error) {
          if (isConnectivityError(error)) {
            triggerCloudBackoff();
          }
          console.warn(`Failed to cache cloud document ${doc.id} locally:`, error);
        } finally {
          cacheSyncInFlightRef.current.delete(flightKey);
        }
      });
    },
    [isAuthenticated, accessToken, isCloudUnavailable, triggerCloudBackoff]
  );

  const loadInitial = useCallback(
    async (showLoading = true, keepExpanded = false) => {
      const expandedMode = keepExpanded && isShowingAllRef.current;

      if (showLoading) {
        setIsLoading(true);
      }

      setIsLoadingMore(false);

      try {
        if (isAuthenticated && accessToken && !isCloudUnavailable()) {
          const pageSize = expandedMode ? PAGE_SIZE : INITIAL_DOCS_COUNT;

          try {
            const page = await documentService.listCloudDocuments(accessToken, 0, pageSize);
            let { privateDocs, sharedByOwnerDocs } = await classifyOwnedDocuments(page.items);
            let hasMoreAfterClassify = page.hasMore;

            if (
              !expandedMode &&
              page.hasMore &&
              page.items.length === INITIAL_DOCS_COUNT &&
              sharedByOwnerDocs.length > 0 &&
              privateDocs.length < INITIAL_DOCS_COUNT
            ) {
              // Re-seed collapsed mode from a full page when owner-shared documents
              // consume slots in the initial fetch, which can otherwise overstate hasMore
              // for the private section.
              const expandedSeedPage = await documentService.listCloudDocuments(
                accessToken,
                0,
                PAGE_SIZE
              );
              const expandedClassified = await classifyOwnedDocuments(expandedSeedPage.items);

              privateDocs = expandedClassified.privateDocs;
              sharedByOwnerDocs = expandedClassified.sharedByOwnerDocs;
              hasMoreAfterClassify = expandedSeedPage.hasMore;
            }

            setDocuments(privateDocs);
            setOwnerSharedDocuments(sharedByOwnerDocs);
            setHasMore(hasMoreAfterClassify);
            setOwnerSharedHasMore(sharedByOwnerDocs.length > 0 && hasMoreAfterClassify);
            setIsShowingAll(expandedMode);
            nextCloudPageRef.current = 1;
            clearCloudBackoff();
            void ensureCloudDocsCachedLocally([...privateDocs, ...sharedByOwnerDocs]);
            return;
          } catch (cloudError) {
            if (cloudError instanceof DocumentServiceApiError && cloudError.status === 401) {
              // Stale token: attempt silent re-auth and degrade to local cache.
              // When refreshSessionThunk resolves the new accessToken, the dep change
              // will recreate loadInitial and re-trigger this effect automatically.
              void refreshRef.current();
              // fall through to local IDB below — no backoff so retry is immediate
            } else if (!isConnectivityError(cloudError)) {
              throw cloudError;
            } else {
              triggerCloudBackoff();
            }

            // If cloud is unreachable, degrade gracefully to local IndexedDB documents.
            const allLocalDocs = sortByUpdatedAtDesc(await documentService.getAllDocumentsMeta());
            localAllDocsRef.current = allLocalDocs;

            // Preserve the last known shared document IDs so we can exclude them from
            // the private section and keep them visible in the shared section.
            const sharedDocIds = new Set([
              ...sharedWithMeDocumentsRef.current.map((doc) => doc.id),
              ...ownerSharedDocumentsRef.current.map((doc) => doc.id),
            ]);

            // Filter out shared documents from the private section to avoid duplicates
            const localPrivateDocs = allLocalDocs.filter((doc) => !sharedDocIds.has(doc.id));
            setOwnerSharedDocuments([...ownerSharedDocumentsRef.current]);
            setOwnerSharedHasMore(false);

            const initialCount = expandedMode
              ? Math.min(PAGE_SIZE, localPrivateDocs.length)
              : Math.min(INITIAL_DOCS_COUNT, localPrivateDocs.length);
            const initialDocs = localPrivateDocs.slice(0, initialCount);

            setDocuments(initialDocs);
            localLoadedCountRef.current = initialDocs.length;
            setHasMore(localPrivateDocs.length > initialDocs.length);
            setIsShowingAll(expandedMode);
            return;
          }
        }

        const docs = sortByUpdatedAtDesc(await documentService.getAllDocumentsMeta());
        localAllDocsRef.current = docs;
        if (!isAuthenticated || !accessToken) {
          setOwnerSharedDocuments([]);
          setOwnerSharedHasMore(false);
        }

        // When authenticated, filter out shared documents from private section
        // to avoid duplicates when cloud is unavailable
        let privateDocs: LocalDocumentEntry[];
        if (isAuthenticated && accessToken) {
          const sharedDocIds = new Set([
            ...sharedWithMeDocumentsRef.current.map((doc) => doc.id),
            ...ownerSharedDocumentsRef.current.map((doc) => doc.id),
          ]);
          privateDocs = docs.filter((doc) => !sharedDocIds.has(doc.id));
        } else {
          privateDocs = docs;
        }

        const initialCount = expandedMode
          ? Math.min(PAGE_SIZE, privateDocs.length)
          : Math.min(INITIAL_DOCS_COUNT, privateDocs.length);
        const initialDocs = privateDocs.slice(0, initialCount);

        setDocuments(initialDocs);
        localLoadedCountRef.current = initialDocs.length;
        setHasMore(privateDocs.length > initialDocs.length);
        setIsShowingAll(expandedMode);
      } catch (error) {
        console.error('Failed to load documents:', error);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [
      isAuthenticated,
      accessToken,
      classifyOwnedDocuments,
      ensureCloudDocsCachedLocally,
      isCloudUnavailable,
      triggerCloudBackoff,
      clearCloudBackoff,
    ]
  );

  const refresh = useCallback(
    async (showLoading = true) => {
      await loadInitial(showLoading, true);

      if (!isAuthenticated || !accessToken) {
        setSharedWithMeDocuments([]);
        setSharedWithMeHasMore(false);
        setIsSharedLoading(false);
        setIsSharedLoadingMore(false);
        setIsShowingAllShared(false);
        nextSharedPageRef.current = 0;
        return;
      }

      if (isCloudUnavailable()) {
        // Preserve the last known shared lists while offline/backing off.
        setIsSharedLoading(false);
        setIsSharedLoadingMore(false);
        return;
      }

      const pageSize = isShowingAllSharedRef.current ? PAGE_SIZE : INITIAL_DOCS_COUNT;
      setIsSharedLoading(showLoading);
      setIsSharedLoadingMore(false);

      try {
        const sharedPage = await documentService.listSharedDocuments(accessToken, 0, pageSize);
        setSharedWithMeDocuments(
          sharedPage.items.map((doc) => ({ ...doc, relationship: 'collaborator' }))
        );
        setSharedWithMeHasMore(sharedPage.hasMore);
        nextSharedPageRef.current = 1;
        clearCloudBackoff();
        void ensureCloudDocsCachedLocally(sharedPage.items);
      } catch (error) {
        if (isConnectivityError(error)) {
          triggerCloudBackoff();
        }
        console.error('Failed to load shared documents:', error);
      } finally {
        setIsSharedLoading(false);
      }
    },
    [
      loadInitial,
      isAuthenticated,
      accessToken,
      ensureCloudDocsCachedLocally,
      isCloudUnavailable,
      triggerCloudBackoff,
      clearCloudBackoff,
    ]
  );

  const showTrashDocuments = useCallback(async () => {
    if (!isAuthenticated || !accessToken || isCloudUnavailable()) {
      setTrashedDocuments([]);
      setTrashHasMore(false);
      return;
    }

    setIsTrashLoading(true);
    setIsTrashLoadingMore(false);

    try {
      const page = await documentService.listCloudDocuments(accessToken, 0, PAGE_SIZE, {
        trashed: true,
      });
      setTrashedDocuments(page.items);
      setTrashHasMore(page.hasMore);
      nextTrashCloudPageRef.current = 1;
      clearCloudBackoff();
    } catch (error) {
      if (isConnectivityError(error)) {
        triggerCloudBackoff();
      }
      console.error('Failed to load trash documents:', error);
    } finally {
      setIsTrashLoading(false);
    }
  }, [isAuthenticated, accessToken, isCloudUnavailable, triggerCloudBackoff, clearCloudBackoff]);

  const refreshTrash = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        await showTrashDocuments();
        return;
      }

      if (!isAuthenticated || !accessToken || isCloudUnavailable()) {
        setTrashedDocuments([]);
        setTrashHasMore(false);
        return;
      }

      try {
        const page = await documentService.listCloudDocuments(accessToken, 0, PAGE_SIZE, {
          trashed: true,
        });
        setTrashedDocuments(page.items);
        setTrashHasMore(page.hasMore);
        nextTrashCloudPageRef.current = 1;
        clearCloudBackoff();
      } catch (error) {
        if (isConnectivityError(error)) {
          triggerCloudBackoff();
        }
        console.error('Failed to refresh trash documents:', error);
      }
    },
    [
      showTrashDocuments,
      isAuthenticated,
      accessToken,
      isCloudUnavailable,
      triggerCloudBackoff,
      clearCloudBackoff,
    ]
  );

  const showAllDocuments = useCallback(() => {
    if (isShowingAll) {
      return;
    }

    setIsShowingAll(true);

    if (isAuthenticated && accessToken && !isCloudUnavailable()) {
      setIsLoadingMore(true);

      void (async () => {
        try {
          // Re-seed expanded mode from the first full-sized page to avoid skipping
          // documents between the initial (size=7) and expanded (size=20) queries.
          const page = await documentService.listCloudDocuments(accessToken, 0, PAGE_SIZE);
          const { privateDocs, sharedByOwnerDocs } = await classifyOwnedDocuments(page.items);

          if (!isMountedRef.current) {
            return;
          }

          setDocuments(privateDocs);
          setOwnerSharedDocuments(sharedByOwnerDocs);
          setHasMore(page.hasMore);
          setOwnerSharedHasMore(sharedByOwnerDocs.length > 0 && page.hasMore);
          nextCloudPageRef.current = 1;
          clearCloudBackoff();
          void ensureCloudDocsCachedLocally([...privateDocs, ...sharedByOwnerDocs]);
        } catch (error) {
          if (isConnectivityError(error)) {
            triggerCloudBackoff();
          }
          console.error('Failed to expand cloud documents list:', error);
        } finally {
          if (isMountedRef.current) {
            setIsLoadingMore(false);
          }
        }
      })();

      return;
    }

    const expanded = localAllDocsRef.current.slice(
      0,
      Math.min(PAGE_SIZE, localAllDocsRef.current.length)
    );

    // When authenticated, filter out shared documents from private section
    if (isAuthenticated && accessToken) {
      const sharedDocIds = new Set([
        ...sharedWithMeDocumentsRef.current.map((doc) => doc.id),
        ...ownerSharedDocumentsRef.current.map((doc) => doc.id),
      ]);

      const localPrivateDocs = localAllDocsRef.current.filter((doc) => !sharedDocIds.has(doc.id));
      const privateExpanded = localPrivateDocs.slice(
        0,
        Math.min(PAGE_SIZE, localPrivateDocs.length)
      );

      setDocuments(privateExpanded);
      localLoadedCountRef.current = privateExpanded.length;
      setHasMore(localPrivateDocs.length > localLoadedCountRef.current);
    } else {
      setDocuments(expanded);
      localLoadedCountRef.current = expanded.length;
      setHasMore(localAllDocsRef.current.length > localLoadedCountRef.current);
    }
  }, [
    isShowingAll,
    isAuthenticated,
    accessToken,
    classifyOwnedDocuments,
    ensureCloudDocsCachedLocally,
    isCloudUnavailable,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  const showAllSharedDocuments = useCallback(() => {
    if (isShowingAllShared) {
      return;
    }

    setIsShowingAllShared(true);

    if (!isAuthenticated || !accessToken || isCloudUnavailable()) {
      return;
    }

    if (!isShowingAllRef.current) {
      showAllDocuments();
    }

    setIsSharedLoadingMore(true);

    void (async () => {
      try {
        const sharedPage = await documentService.listSharedDocuments(accessToken, 0, PAGE_SIZE);
        setSharedWithMeDocuments(
          sharedPage.items.map((doc) => ({ ...doc, relationship: 'collaborator' }))
        );
        setSharedWithMeHasMore(sharedPage.hasMore);
        nextSharedPageRef.current = 1;
        clearCloudBackoff();
        void ensureCloudDocsCachedLocally(sharedPage.items);
      } catch (error) {
        if (isConnectivityError(error)) {
          triggerCloudBackoff();
        }
        console.error('Failed to expand shared documents list:', error);
      } finally {
        setIsSharedLoadingMore(false);
      }
    })();
  }, [
    isShowingAllShared,
    isAuthenticated,
    accessToken,
    showAllDocuments,
    ensureCloudDocsCachedLocally,
    isCloudUnavailable,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  const loadMore = useCallback(async () => {
    if (!isShowingAll || isLoadingMore || !hasMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      if (isAuthenticated && accessToken && !isCloudUnavailable()) {
        const nextPage = nextCloudPageRef.current;
        const page = await documentService.listCloudDocuments(accessToken, nextPage, PAGE_SIZE);
        const { privateDocs: nextPrivateDocs, sharedByOwnerDocs: nextOwnerSharedDocs } =
          await classifyOwnedDocuments(page.items);

        setDocuments((prevDocs) => {
          const seen = new Set(prevDocs.map((doc) => doc.id));
          const newDocs = nextPrivateDocs.filter((doc) => !seen.has(doc.id));
          return [...prevDocs, ...newDocs];
        });

        const hadOwnerSharedDocs = ownerSharedDocumentsRef.current.length > 0;
        setOwnerSharedDocuments((prevDocs) => mergeUniqueDocuments(prevDocs, nextOwnerSharedDocs));
        setOwnerSharedHasMore(
          page.hasMore && (hadOwnerSharedDocs || nextOwnerSharedDocs.length > 0)
        );

        nextCloudPageRef.current = nextPage + 1;
        setHasMore(page.hasMore);
        clearCloudBackoff();
        void ensureCloudDocsCachedLocally([...nextPrivateDocs, ...nextOwnerSharedDocs]);
      } else {
        // Offline: load more from local cache, filtering out shared documents
        const sharedDocIds = new Set([
          ...sharedWithMeDocumentsRef.current.map((doc) => doc.id),
          ...ownerSharedDocumentsRef.current.map((doc) => doc.id),
        ]);

        const localPrivateDocs = localAllDocsRef.current.filter((doc) => !sharedDocIds.has(doc.id));

        const start = localLoadedCountRef.current;
        const nextChunk = localPrivateDocs.slice(start, start + PAGE_SIZE);

        setDocuments((prevDocs) => {
          const seen = new Set(prevDocs.map((doc) => doc.id));
          const filteredDocs = nextChunk.filter((doc) => !seen.has(doc.id));
          return [...prevDocs, ...filteredDocs];
        });
        localLoadedCountRef.current = start + nextChunk.length;
        setHasMore(localPrivateDocs.length > localLoadedCountRef.current);
      }
    } catch (error) {
      if (isConnectivityError(error)) {
        triggerCloudBackoff();
      }
      console.error('Failed to load more documents:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    isShowingAll,
    isLoadingMore,
    hasMore,
    isAuthenticated,
    accessToken,
    classifyOwnedDocuments,
    ensureCloudDocsCachedLocally,
    isCloudUnavailable,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  const loadMoreSharedDocuments = useCallback(async () => {
    if (
      !isAuthenticated ||
      !accessToken ||
      isCloudUnavailable() ||
      isSharedLoading ||
      isSharedLoadingMore ||
      (!sharedWithMeHasMore && !ownerSharedHasMore)
    ) {
      return;
    }

    setIsSharedLoadingMore(true);
    try {
      if (sharedWithMeHasMore) {
        const nextPage = nextSharedPageRef.current;
        const page = await documentService.listSharedDocuments(accessToken, nextPage, PAGE_SIZE);

        setSharedWithMeDocuments((prevDocs) =>
          mergeUniqueDocuments(
            prevDocs,
            page.items.map((doc) => ({ ...doc, relationship: 'collaborator' as const }))
          )
        );

        nextSharedPageRef.current = nextPage + 1;
        setSharedWithMeHasMore(page.hasMore);
        clearCloudBackoff();
        void ensureCloudDocsCachedLocally(page.items);
      }

      if (ownerSharedHasMore) {
        if (!isShowingAllRef.current) {
          showAllDocuments();
        }
        await loadMore();
      }
    } catch (error) {
      if (isConnectivityError(error)) {
        triggerCloudBackoff();
      }
      console.error('Failed to load more shared documents:', error);
    } finally {
      setIsSharedLoadingMore(false);
    }
  }, [
    isAuthenticated,
    accessToken,
    isCloudUnavailable,
    isSharedLoading,
    isSharedLoadingMore,
    sharedWithMeHasMore,
    ownerSharedHasMore,
    showAllDocuments,
    loadMore,
    ensureCloudDocsCachedLocally,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  const loadMoreTrashDocuments = useCallback(async () => {
    if (
      !isAuthenticated ||
      !accessToken ||
      isCloudUnavailable() ||
      isTrashLoading ||
      isTrashLoadingMore ||
      !trashHasMore
    ) {
      return;
    }

    setIsTrashLoadingMore(true);
    try {
      const nextPage = nextTrashCloudPageRef.current;
      const page = await documentService.listCloudDocuments(accessToken, nextPage, PAGE_SIZE, {
        trashed: true,
      });

      setTrashedDocuments((prevDocs) => {
        const seen = new Set(prevDocs.map((doc) => doc.id));
        const newDocs = page.items.filter((doc) => !seen.has(doc.id));
        return [...prevDocs, ...newDocs];
      });

      nextTrashCloudPageRef.current = nextPage + 1;
      setTrashHasMore(page.hasMore);
      clearCloudBackoff();
    } catch (error) {
      if (isConnectivityError(error)) {
        triggerCloudBackoff();
      }
      console.error('Failed to load more trash documents:', error);
    } finally {
      setIsTrashLoadingMore(false);
    }
  }, [
    isAuthenticated,
    accessToken,
    isCloudUnavailable,
    isTrashLoading,
    isTrashLoadingMore,
    trashHasMore,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  useEffect(() => {
    if (isInitializing) {
      setIsLoading(true);
      setIsSharedLoading(true);
      return;
    }

    // Security: when the auth boundary changes (guest → authenticated or vice-versa),
    // reset all in-memory local document refs so the previous session's cached
    // list is never momentarily shown to the new session before the API responds.
    const isAuthTransition =
      prevIsAuthenticatedRef.current !== null && prevIsAuthenticatedRef.current !== isAuthenticated;

    if (isAuthTransition) {
      localAllDocsRef.current = [];
      localLoadedCountRef.current = 0;
      nextCloudPageRef.current = 0;
    }

    prevIsAuthenticatedRef.current = isAuthenticated;

    void loadInitial(true, false);
  }, [isInitializing, isAuthenticated, loadInitial]);

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    if (!isAuthenticated || !accessToken) {
      setSharedWithMeDocuments([]);
      setOwnerSharedDocuments([]);
      setOwnerSharedHasMore(false);
      setIsSharedLoading(false);
      setIsSharedLoadingMore(false);
      setSharedWithMeHasMore(false);
      setIsShowingAllShared(false);
      nextSharedPageRef.current = 0;
      return;
    }

    if (isCloudUnavailable()) {
      // Preserve the last known shared lists while offline/backing off.
      setIsSharedLoading(false);
      setIsSharedLoadingMore(false);
      return;
    }

    let cancelled = false;
    setIsSharedLoading(true);
    setIsSharedLoadingMore(false);

    const run = async () => {
      try {
        const pageSize = isShowingAllSharedRef.current ? PAGE_SIZE : INITIAL_DOCS_COUNT;
        const page = await documentService.listSharedDocuments(accessToken, 0, pageSize);
        if (!cancelled) {
          setSharedWithMeDocuments(
            page.items.map((doc) => ({ ...doc, relationship: 'collaborator' }))
          );
          setSharedWithMeHasMore(page.hasMore);
          nextSharedPageRef.current = 1;
          clearCloudBackoff();
          void ensureCloudDocsCachedLocally(page.items);
        }
      } catch (error) {
        if (error instanceof DocumentServiceApiError && error.status === 401) {
          // Stale token: trigger silent re-auth; shared list will reload automatically
          // once the new accessToken dep change re-runs this effect.
          void refreshRef.current();
          if (!cancelled) {
            setSharedWithMeDocuments([]);
            setSharedWithMeHasMore(false);
            nextSharedPageRef.current = 0;
          }
          return;
        }
        if (isConnectivityError(error)) {
          triggerCloudBackoff();
        }
        console.error('Failed to load shared documents:', error);
        if (!cancelled) {
          setSharedWithMeDocuments([]);
          setSharedWithMeHasMore(false);
          nextSharedPageRef.current = 0;
        }
      } finally {
        if (!cancelled) {
          setIsSharedLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    isInitializing,
    isAuthenticated,
    accessToken,
    ensureCloudDocsCachedLocally,
    isCloudUnavailable,
    triggerCloudBackoff,
    clearCloudBackoff,
  ]);

  useEffect(() => {
    if (isInitializing || isAuthenticated) {
      return;
    }

    setSharedWithMeDocuments([]);
    setOwnerSharedDocuments([]);
    setOwnerSharedHasMore(false);
    setIsSharedLoading(false);
    setIsSharedLoadingMore(false);
    setSharedWithMeHasMore(false);
    setIsShowingAllShared(false);
    nextSharedPageRef.current = 0;
    setTrashedDocuments([]);
    setTrashHasMore(false);
    setIsTrashLoading(false);
    setIsTrashLoadingMore(false);
  }, [isInitializing, isAuthenticated]);

  useEffect(() => {
    const handleMetaUpdated = (event: CustomEvent<{ id: string; meta: DocumentMeta }>) => {
      const { id, meta } = event.detail;
      const { entries: nextSharedWithMeDocuments, exists: existsInSharedWithMe } =
        updateDocumentMetaInList(sharedWithMeDocumentsRef.current, id, meta);
      const { entries: nextOwnerSharedDocuments, exists: existsInOwnerShared } =
        updateDocumentMetaInList(ownerSharedDocumentsRef.current, id, meta);
      const existsInShared = existsInSharedWithMe || existsInOwnerShared;

      if (existsInSharedWithMe) {
        sharedWithMeDocumentsRef.current = nextSharedWithMeDocuments;
        setSharedWithMeDocuments(nextSharedWithMeDocuments);
      }

      if (existsInOwnerShared) {
        ownerSharedDocumentsRef.current = nextOwnerSharedDocuments;
        setOwnerSharedDocuments(nextOwnerSharedDocuments);
      }

      const { entries: updatedPrivateDocs, exists: existsInPrivate } = updateDocumentMetaInList(
        documentsRef.current,
        id,
        meta
      );
      const shouldInsertIntoPrivate = !existsInPrivate && !existsInShared;

      if (!existsInPrivate && !shouldInsertIntoPrivate) {
        return;
      }

      const sortedPrivateDocs = shouldInsertIntoPrivate
        ? sortByUpdatedAtDesc([{ id, meta }, ...documentsRef.current])
        : updatedPrivateDocs;
      const nextPrivateDocs = isShowingAll
        ? sortedPrivateDocs
        : sortedPrivateDocs.slice(0, INITIAL_DOCS_COUNT);

      documentsRef.current = nextPrivateDocs;
      setDocuments(nextPrivateDocs);

      const localDocs = localAllDocsRef.current;
      const existsLocally = localDocs.some((doc) => doc.id === id);
      if (existsLocally || shouldInsertIntoPrivate) {
        localAllDocsRef.current = sortByUpdatedAtDesc(
          existsLocally
            ? localDocs.map((doc) => (doc.id === id ? { ...doc, meta } : doc))
            : [{ id, meta }, ...localDocs]
        );
      }
    };

    window.addEventListener('document-meta-updated', handleMetaUpdated as EventListener);
    return () => {
      window.removeEventListener('document-meta-updated', handleMetaUpdated as EventListener);
    };
  }, [isShowingAll]);

  useEffect(() => {
    const handleDocsChanged = () => {
      void refresh(false);
      if (trashedCountRef.current > 0) {
        void refreshTrash(false);
      }
    };

    window.addEventListener('local-documents-changed', handleDocsChanged);
    window.addEventListener('cloud-documents-changed', handleDocsChanged);

    return () => {
      window.removeEventListener('local-documents-changed', handleDocsChanged);
      window.removeEventListener('cloud-documents-changed', handleDocsChanged);
    };
  }, [refresh, refreshTrash]);

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
