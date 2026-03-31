'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { documentService } from '@/services/document.service';
import { useAuth } from '@/hooks/useAuth.hook';
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

function sortByUpdatedAtDesc<T extends LocalDocumentEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => new Date(b.meta.updatedAt).getTime() - new Date(a.meta.updatedAt).getTime()
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

function combineSharedDocuments(
  sharedWithMeDocuments: SharedDocumentEntry[],
  ownerSharedDocuments: SharedDocumentEntry[]
): SharedDocumentEntry[] {
  return mergeUniqueDocuments(sharedWithMeDocuments, ownerSharedDocuments);
}

export function useLocalDocuments() {
  const [documents, setDocuments] = useState<LocalDocumentEntry[]>([]);
  const [sharedWithMeDocuments, setSharedWithMeDocuments] = useState<SharedDocumentEntry[]>([]);
  const [ownerSharedDocuments, setOwnerSharedDocuments] = useState<SharedDocumentEntry[]>([]);
  const [trashedDocuments, setTrashedDocuments] = useState<LocalDocumentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isShowingAll, setIsShowingAll] = useState(false);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  const [isSharedLoading, setIsSharedLoading] = useState(false);
  const [isSharedLoadingMore, setIsSharedLoadingMore] = useState(false);
  const [sharedWithMeHasMore, setSharedWithMeHasMore] = useState(false);
  const [isShowingAllShared, setIsShowingAllShared] = useState(false);
  const [isTrashLoadingMore, setIsTrashLoadingMore] = useState(false);
  const [trashHasMore, setTrashHasMore] = useState(false);
  const { isAuthenticated, accessToken } = useAuth();

  const nextCloudPageRef = useRef(0);
  const nextSharedPageRef = useRef(0);
  const nextTrashCloudPageRef = useRef(0);
  const localAllDocsRef = useRef<LocalDocumentEntry[]>([]);
  const localLoadedCountRef = useRef(0);
  const documentsRef = useRef<LocalDocumentEntry[]>([]);
  const isShowingAllRef = useRef(false);
  const isShowingAllSharedRef = useRef(false);
  const trashedCountRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

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

      const checks = await Promise.all(
        docs.map(async (doc) => {
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
        })
      );

      return {
        privateDocs: checks.filter((entry) => !entry.hasExtraUser).map((entry) => entry.doc),
        sharedByOwnerDocs: checks
          .filter((entry) => entry.hasExtraUser)
          .map((entry) => ({ ...entry.doc, relationship: 'owner' })),
      };
    },
    [isAuthenticated, accessToken]
  );

  const loadInitial = useCallback(
    async (showLoading = true, keepExpanded = false) => {
      const expandedMode = keepExpanded && isShowingAllRef.current;

      if (showLoading) {
        setIsLoading(true);
      }

      setIsLoadingMore(false);

      try {
        if (isAuthenticated && accessToken) {
          const pageSize = expandedMode ? PAGE_SIZE : INITIAL_DOCS_COUNT;
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
          setIsShowingAll(expandedMode);
          nextCloudPageRef.current = 1;
          return;
        }

        const docs = sortByUpdatedAtDesc(await documentService.getAllDocumentsMeta());
        localAllDocsRef.current = docs;
        setOwnerSharedDocuments([]);

        const initialCount = expandedMode
          ? Math.min(PAGE_SIZE, docs.length)
          : Math.min(INITIAL_DOCS_COUNT, docs.length);
        const initialDocs = docs.slice(0, initialCount);

        setDocuments(initialDocs);
        localLoadedCountRef.current = initialDocs.length;
        setHasMore(docs.length > initialDocs.length);
        setIsShowingAll(expandedMode);
      } catch (error) {
        console.error('Failed to load documents:', error);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [isAuthenticated, accessToken, classifyOwnedDocuments]
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
      } catch (error) {
        console.error('Failed to load shared documents:', error);
      } finally {
        setIsSharedLoading(false);
      }
    },
    [loadInitial, isAuthenticated, accessToken]
  );

  const showTrashDocuments = useCallback(async () => {
    if (!isAuthenticated || !accessToken) {
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
    } catch (error) {
      console.error('Failed to load trash documents:', error);
    } finally {
      setIsTrashLoading(false);
    }
  }, [isAuthenticated, accessToken]);

  const refreshTrash = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        await showTrashDocuments();
        return;
      }

      if (!isAuthenticated || !accessToken) {
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
      } catch (error) {
        console.error('Failed to refresh trash documents:', error);
      }
    },
    [showTrashDocuments, isAuthenticated, accessToken]
  );

  const showAllDocuments = useCallback(() => {
    if (isShowingAll) {
      return;
    }

    setIsShowingAll(true);

    if (isAuthenticated && accessToken) {
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
          nextCloudPageRef.current = 1;
        } catch (error) {
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
    setDocuments(expanded);
    localLoadedCountRef.current = expanded.length;
    setHasMore(localAllDocsRef.current.length > localLoadedCountRef.current);
  }, [isShowingAll, isAuthenticated, accessToken, classifyOwnedDocuments]);

  const showAllSharedDocuments = useCallback(() => {
    if (isShowingAllShared) {
      return;
    }

    setIsShowingAllShared(true);

    if (!isAuthenticated || !accessToken) {
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
      } catch (error) {
        console.error('Failed to expand shared documents list:', error);
      } finally {
        setIsSharedLoadingMore(false);
      }
    })();
  }, [isShowingAllShared, isAuthenticated, accessToken, showAllDocuments]);

  const loadMore = useCallback(async () => {
    if (!isShowingAll || isLoadingMore || !hasMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      if (isAuthenticated && accessToken) {
        const nextPage = nextCloudPageRef.current;
        const page = await documentService.listCloudDocuments(accessToken, nextPage, PAGE_SIZE);
        const { privateDocs: nextPrivateDocs, sharedByOwnerDocs: nextOwnerSharedDocs } =
          await classifyOwnedDocuments(page.items);

        setDocuments((prevDocs) => {
          const seen = new Set(prevDocs.map((doc) => doc.id));
          const newDocs = nextPrivateDocs.filter((doc) => !seen.has(doc.id));
          return [...prevDocs, ...newDocs];
        });

        setOwnerSharedDocuments((prevDocs) => mergeUniqueDocuments(prevDocs, nextOwnerSharedDocs));

        nextCloudPageRef.current = nextPage + 1;
        setHasMore(page.hasMore);
      } else {
        const start = localLoadedCountRef.current;
        const nextChunk = localAllDocsRef.current.slice(start, start + PAGE_SIZE);

        setDocuments((prevDocs) => [...prevDocs, ...nextChunk]);
        localLoadedCountRef.current = start + nextChunk.length;
        setHasMore(localAllDocsRef.current.length > localLoadedCountRef.current);
      }
    } catch (error) {
      console.error('Failed to load more documents:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isShowingAll, isLoadingMore, hasMore, isAuthenticated, accessToken, classifyOwnedDocuments]);

  const loadMoreSharedDocuments = useCallback(async () => {
    if (
      !isAuthenticated ||
      !accessToken ||
      isSharedLoading ||
      isSharedLoadingMore ||
      (!sharedWithMeHasMore && !hasMore)
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
      }

      if (hasMore) {
        if (!isShowingAllRef.current) {
          showAllDocuments();
        }
        await loadMore();
      }
    } catch (error) {
      console.error('Failed to load more shared documents:', error);
    } finally {
      setIsSharedLoadingMore(false);
    }
  }, [
    isAuthenticated,
    accessToken,
    isSharedLoading,
    isSharedLoadingMore,
    sharedWithMeHasMore,
    hasMore,
    showAllDocuments,
    loadMore,
  ]);

  const loadMoreTrashDocuments = useCallback(async () => {
    if (!isAuthenticated || !accessToken || isTrashLoading || isTrashLoadingMore || !trashHasMore) {
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
    } catch (error) {
      console.error('Failed to load more trash documents:', error);
    } finally {
      setIsTrashLoadingMore(false);
    }
  }, [isAuthenticated, accessToken, isTrashLoading, isTrashLoadingMore, trashHasMore]);

  useEffect(() => {
    void loadInitial(true, false);
  }, [isAuthenticated, accessToken, loadInitial]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setSharedWithMeDocuments([]);
      setOwnerSharedDocuments([]);
      setIsSharedLoading(false);
      setIsSharedLoadingMore(false);
      setSharedWithMeHasMore(false);
      setIsShowingAllShared(false);
      nextSharedPageRef.current = 0;
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
        }
      } catch (error) {
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
  }, [isAuthenticated, accessToken]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }

    setSharedWithMeDocuments([]);
    setOwnerSharedDocuments([]);
    setIsSharedLoading(false);
    setIsSharedLoadingMore(false);
    setSharedWithMeHasMore(false);
    setIsShowingAllShared(false);
    nextSharedPageRef.current = 0;
    setTrashedDocuments([]);
    setTrashHasMore(false);
    setIsTrashLoading(false);
    setIsTrashLoadingMore(false);
  }, [isAuthenticated]);

  useEffect(() => {
    const handleMetaUpdated = (event: CustomEvent<{ id: string; meta: DocumentMeta }>) => {
      const { id, meta } = event.detail;
      const prevDocs = documentsRef.current;
      const exists = prevDocs.some((doc) => doc.id === id);

      const newDocs = exists
        ? prevDocs.map((doc) => (doc.id === id ? { ...doc, meta } : doc))
        : [{ id, meta }, ...prevDocs];

      const sorted = sortByUpdatedAtDesc(newDocs);
      const nextDocs = isShowingAll ? sorted : sorted.slice(0, INITIAL_DOCS_COUNT);
      const moreExists = sorted.length > INITIAL_DOCS_COUNT;

      documentsRef.current = nextDocs;
      setDocuments(() => nextDocs);

      if (!isShowingAll) {
        setHasMore(moreExists);
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
    sharedHasMore: sharedWithMeHasMore || (ownerSharedDocuments.length > 0 && hasMore),
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
