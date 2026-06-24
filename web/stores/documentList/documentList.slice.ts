import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import { isConnectivityError } from '@/lib/cloud-connectivity.util';
import type { RootState } from '../store';
import { refreshSessionThunk } from '../auth/auth.slice';
import type { DocumentMeta } from '@/types/document.types';
import type {
  DocumentListState,
  LocalDocumentEntry,
  SharedDocumentEntry,
} from './documentList.types';
import {
  INITIAL_DOCS_COUNT,
  PAGE_SIZE,
  sortByUpdatedAtDesc,
  mergeUniqueDocuments,
  updateDocumentMetaInList,
  classifyOwnedDocuments,
  ensureCloudDocsCachedLocally,
} from './documentList.utils';

const initialState: DocumentListState = {
  documents: [],
  isLoading: true,
  isLoadingMore: false,
  hasMore: false,
  isShowingAll: false,

  sharedWithMeDocuments: [],
  ownerSharedDocuments: [],
  isSharedLoading: true,
  isSharedLoadingMore: false,
  sharedWithMeHasMore: false,
  ownerSharedHasMore: false,
  isShowingAllShared: false,

  trashedDocuments: [],
  isTrashLoading: false,
  isTrashLoadingMore: false,
  trashHasMore: false,

  nextCloudPage: 0,
  nextSharedPage: 0,
  nextTrashCloudPage: 0,

  localLoadedCount: 0,
  localAllDocs: [],
};

export const fetchDocumentsThunk = createAsyncThunk<
  {
    documents: LocalDocumentEntry[];
    ownerSharedDocuments: SharedDocumentEntry[];
    hasMore: boolean;
    ownerSharedHasMore: boolean;
    isShowingAll: boolean;
    nextCloudPage: number;
    localAllDocs?: LocalDocumentEntry[];
    localLoadedCount?: number;
    degradedToLocal?: boolean;
    errorType?: 'connectivity_error' | 'unauthorized' | null;
  },
  {
    showLoading?: boolean;
    keepExpanded?: boolean;
    isCloudUnavailable: boolean;
    cacheSyncInFlight: Set<string>;
  },
  {
    state: RootState;
  }
>(
  'documentList/fetchDocuments',
  async (
    { keepExpanded = false, isCloudUnavailable, cacheSyncInFlight },
    { dispatch, getState }
  ) => {
    const state = getState();
    const { user, accessToken } = state.auth;
    const isAuthenticated = !!user && !!accessToken;
    const { isShowingAll, sharedWithMeDocuments, ownerSharedDocuments } = state.documentList;

    const expandedMode = keepExpanded && isShowingAll;

    if (isAuthenticated && accessToken && !isCloudUnavailable) {
      const pageSize = expandedMode ? PAGE_SIZE : INITIAL_DOCS_COUNT;
      try {
        const page = await documentService.listCloudDocuments(accessToken, 0, pageSize);
        let { privateDocs, sharedByOwnerDocs } = await classifyOwnedDocuments(
          page.items,
          isAuthenticated,
          accessToken
        );
        let hasMoreAfterClassify = page.hasMore;

        if (
          !expandedMode &&
          page.hasMore &&
          page.items.length === INITIAL_DOCS_COUNT &&
          sharedByOwnerDocs.length > 0 &&
          privateDocs.length < INITIAL_DOCS_COUNT
        ) {
          const expandedSeedPage = await documentService.listCloudDocuments(
            accessToken,
            0,
            PAGE_SIZE
          );
          const expandedClassified = await classifyOwnedDocuments(
            expandedSeedPage.items,
            isAuthenticated,
            accessToken
          );
          privateDocs = expandedClassified.privateDocs;
          sharedByOwnerDocs = expandedClassified.sharedByOwnerDocs;
          hasMoreAfterClassify = expandedSeedPage.hasMore;
        }

        void ensureCloudDocsCachedLocally(
          [...privateDocs, ...sharedByOwnerDocs],
          isAuthenticated,
          accessToken,
          isCloudUnavailable,
          cacheSyncInFlight
        );

        return {
          documents: privateDocs,
          ownerSharedDocuments: sharedByOwnerDocs,
          hasMore: hasMoreAfterClassify,
          ownerSharedHasMore: sharedByOwnerDocs.length > 0 && hasMoreAfterClassify,
          isShowingAll: expandedMode,
          nextCloudPage: 1,
          degradedToLocal: false,
        };
      } catch (cloudError) {
        let errorType: 'connectivity_error' | 'unauthorized' | null = null;
        if (cloudError instanceof DocumentServiceApiError && cloudError.status === 401) {
          void dispatch(refreshSessionThunk());
          errorType = 'unauthorized';
        } else if (!isConnectivityError(cloudError)) {
          throw cloudError;
        } else {
          errorType = 'connectivity_error';
        }

        const allLocalDocs = sortByUpdatedAtDesc(await documentService.getAllDocumentsMeta());
        const sharedDocIds = new Set([
          ...sharedWithMeDocuments.map((doc) => doc.id),
          ...ownerSharedDocuments.map((doc) => doc.id),
        ]);

        const localPrivateDocs = allLocalDocs.filter((doc) => !sharedDocIds.has(doc.id));
        const initialCount = expandedMode
          ? Math.min(PAGE_SIZE, localPrivateDocs.length)
          : Math.min(INITIAL_DOCS_COUNT, localPrivateDocs.length);
        const initialDocs = localPrivateDocs.slice(0, initialCount);

        return {
          documents: initialDocs,
          ownerSharedDocuments: [...ownerSharedDocuments],
          hasMore: localPrivateDocs.length > initialDocs.length,
          ownerSharedHasMore: false,
          isShowingAll: expandedMode,
          nextCloudPage: 0,
          localAllDocs: allLocalDocs,
          localLoadedCount: initialDocs.length,
          degradedToLocal: true,
          errorType,
        };
      }
    }

    const docs = sortByUpdatedAtDesc(await documentService.getAllDocumentsMeta());
    let privateDocs: LocalDocumentEntry[];
    if (isAuthenticated && accessToken) {
      const sharedDocIds = new Set([
        ...sharedWithMeDocuments.map((doc) => doc.id),
        ...ownerSharedDocuments.map((doc) => doc.id),
      ]);
      privateDocs = docs.filter((doc) => !sharedDocIds.has(doc.id));
    } else {
      privateDocs = docs;
    }

    const initialCount = expandedMode
      ? Math.min(PAGE_SIZE, privateDocs.length)
      : Math.min(INITIAL_DOCS_COUNT, privateDocs.length);
    const initialDocs = privateDocs.slice(0, initialCount);

    return {
      documents: initialDocs,
      ownerSharedDocuments: isAuthenticated && accessToken ? [...ownerSharedDocuments] : [],
      hasMore: privateDocs.length > initialDocs.length,
      ownerSharedHasMore: false,
      isShowingAll: expandedMode,
      nextCloudPage: 0,
      localAllDocs: docs,
      localLoadedCount: initialDocs.length,
      degradedToLocal: true,
    };
  }
);

export const fetchSharedDocumentsThunk = createAsyncThunk<
  {
    sharedWithMeDocuments: SharedDocumentEntry[];
    sharedWithMeHasMore: boolean;
    nextSharedPage: number;
    errorType?: 'connectivity_error' | 'unauthorized' | null;
  },
  {
    showLoading?: boolean;
    isCloudUnavailable: boolean;
    cacheSyncInFlight: Set<string>;
  },
  {
    state: RootState;
  }
>(
  'documentList/fetchSharedDocuments',
  async ({ isCloudUnavailable, cacheSyncInFlight }, { dispatch, getState }) => {
    const state = getState();
    const { user, accessToken } = state.auth;
    const isAuthenticated = !!user && !!accessToken;
    const { isShowingAllShared } = state.documentList;

    if (!isAuthenticated || !accessToken) {
      return {
        sharedWithMeDocuments: [],
        sharedWithMeHasMore: false,
        nextSharedPage: 0,
      };
    }

    if (isCloudUnavailable) {
      return {
        sharedWithMeDocuments: state.documentList.sharedWithMeDocuments,
        sharedWithMeHasMore: state.documentList.sharedWithMeHasMore,
        nextSharedPage: state.documentList.nextSharedPage,
      };
    }

    const pageSize = isShowingAllShared ? PAGE_SIZE : INITIAL_DOCS_COUNT;
    try {
      const sharedPage = await documentService.listSharedDocuments(accessToken, 0, pageSize);
      const items = sharedPage.items.map((doc) => ({
        ...doc,
        relationship: 'collaborator' as const,
      }));

      void ensureCloudDocsCachedLocally(
        sharedPage.items,
        isAuthenticated,
        accessToken,
        isCloudUnavailable,
        cacheSyncInFlight
      );

      return {
        sharedWithMeDocuments: items,
        sharedWithMeHasMore: sharedPage.hasMore,
        nextSharedPage: 1,
      };
    } catch (error) {
      let errorType: 'connectivity_error' | 'unauthorized' | null = null;
      if (error instanceof DocumentServiceApiError && error.status === 401) {
        void dispatch(refreshSessionThunk());
        errorType = 'unauthorized';
      } else if (isConnectivityError(error)) {
        console.error('Failed to load shared documents:', error);
        errorType = 'connectivity_error';
      } else {
        console.error('Failed to load shared documents:', error);
      }
      return {
        sharedWithMeDocuments:
          errorType === 'unauthorized' ? [] : state.documentList.sharedWithMeDocuments,
        sharedWithMeHasMore:
          errorType === 'unauthorized' ? false : state.documentList.sharedWithMeHasMore,
        nextSharedPage: errorType === 'unauthorized' ? 0 : state.documentList.nextSharedPage,
        errorType,
      };
    }
  }
);

export const fetchTrashDocumentsThunk = createAsyncThunk<
  {
    trashedDocuments: LocalDocumentEntry[];
    trashHasMore: boolean;
    nextTrashCloudPage: number;
    errorType?: 'connectivity_error' | null;
  },
  {
    isCloudUnavailable: boolean;
  },
  {
    state: RootState;
  }
>('documentList/fetchTrashDocuments', async ({ isCloudUnavailable }, { getState }) => {
  const state = getState();
  const { user, accessToken } = state.auth;
  const isAuthenticated = !!user && !!accessToken;

  if (!isAuthenticated || !accessToken || isCloudUnavailable) {
    return {
      trashedDocuments: [],
      trashHasMore: false,
      nextTrashCloudPage: 0,
    };
  }

  try {
    const page = await documentService.listCloudDocuments(accessToken, 0, PAGE_SIZE, {
      trashed: true,
    });
    return {
      trashedDocuments: page.items,
      trashHasMore: page.hasMore,
      nextTrashCloudPage: 1,
    };
  } catch (error) {
    let errorType: 'connectivity_error' | null = null;
    if (isConnectivityError(error)) {
      errorType = 'connectivity_error';
    }
    return {
      trashedDocuments: [],
      trashHasMore: false,
      nextTrashCloudPage: 0,
      errorType,
    };
  }
});

export const loadMoreDocumentsThunk = createAsyncThunk<
  {
    documents: LocalDocumentEntry[];
    ownerSharedDocuments?: SharedDocumentEntry[];
    hasMore: boolean;
    ownerSharedHasMore?: boolean;
    nextCloudPage?: number;
    localLoadedCount?: number;
    errorType?: 'connectivity_error' | null;
  },
  {
    isCloudUnavailable: boolean;
    cacheSyncInFlight: Set<string>;
  },
  {
    state: RootState;
  }
>(
  'documentList/loadMoreDocuments',
  async ({ isCloudUnavailable, cacheSyncInFlight }, { getState }) => {
    const state = getState();
    const { user, accessToken } = state.auth;
    const isAuthenticated = !!user && !!accessToken;
    const {
      nextCloudPage,
      documents,
      hasMore,
      sharedWithMeDocuments,
      ownerSharedDocuments,
      localAllDocs,
      localLoadedCount,
    } = state.documentList;

    if (isAuthenticated && accessToken && !isCloudUnavailable) {
      try {
        const page = await documentService.listCloudDocuments(
          accessToken,
          nextCloudPage,
          PAGE_SIZE
        );
        const { privateDocs: nextPrivateDocs, sharedByOwnerDocs: nextOwnerSharedDocs } =
          await classifyOwnedDocuments(page.items, isAuthenticated, accessToken);

        const seen = new Set(documents.map((doc) => doc.id));
        const filteredDocs = nextPrivateDocs.filter((doc) => !seen.has(doc.id));
        const updatedDocuments = [...documents, ...filteredDocs];

        const hadOwnerSharedDocs = ownerSharedDocuments.length > 0;
        const updatedOwnerSharedDocuments = mergeUniqueDocuments(
          ownerSharedDocuments,
          nextOwnerSharedDocs
        );
        const updatedOwnerSharedHasMore =
          page.hasMore && (hadOwnerSharedDocs || nextOwnerSharedDocs.length > 0);

        void ensureCloudDocsCachedLocally(
          [...nextPrivateDocs, ...nextOwnerSharedDocs],
          isAuthenticated,
          accessToken,
          isCloudUnavailable,
          cacheSyncInFlight
        );

        return {
          documents: updatedDocuments,
          ownerSharedDocuments: updatedOwnerSharedDocuments,
          hasMore: page.hasMore,
          ownerSharedHasMore: updatedOwnerSharedHasMore,
          nextCloudPage: nextCloudPage + 1,
        };
      } catch (error) {
        let errorType: 'connectivity_error' | null = null;
        if (isConnectivityError(error)) {
          errorType = 'connectivity_error';
        }
        return {
          documents,
          hasMore,
          errorType,
        };
      }
    } else {
      const sharedDocIds = new Set([
        ...sharedWithMeDocuments.map((doc) => doc.id),
        ...ownerSharedDocuments.map((doc) => doc.id),
      ]);

      const localPrivateDocs = localAllDocs.filter((doc) => !sharedDocIds.has(doc.id));
      const nextChunk = localPrivateDocs.slice(localLoadedCount, localLoadedCount + PAGE_SIZE);

      const seen = new Set(documents.map((doc) => doc.id));
      const filteredDocs = nextChunk.filter((doc) => !seen.has(doc.id));
      const updatedDocuments = [...documents, ...filteredDocs];

      return {
        documents: updatedDocuments,
        hasMore: localPrivateDocs.length > localLoadedCount + nextChunk.length,
        localLoadedCount: localLoadedCount + nextChunk.length,
      };
    }
  },
  {
    condition: (_, { getState }) => {
      const { isShowingAll, isLoadingMore, hasMore } = (getState() as RootState).documentList;
      if (!isShowingAll || isLoadingMore || !hasMore) {
        return false;
      }
    },
  }
);

export const loadMoreSharedDocumentsThunk = createAsyncThunk<
  {
    sharedWithMeDocuments: SharedDocumentEntry[];
    sharedWithMeHasMore: boolean;
    nextSharedPage: number;
    errorType?: 'connectivity_error' | null;
  },
  {
    isCloudUnavailable: boolean;
    cacheSyncInFlight: Set<string>;
  },
  {
    state: RootState;
  }
>(
  'documentList/loadMoreSharedDocuments',
  async ({ isCloudUnavailable, cacheSyncInFlight }, { getState }) => {
    const state = getState();
    const { user, accessToken } = state.auth;
    const isAuthenticated = !!user && !!accessToken;
    const { sharedWithMeDocuments, nextSharedPage } = state.documentList;

    try {
      const page = await documentService.listSharedDocuments(
        accessToken!,
        nextSharedPage,
        PAGE_SIZE
      );
      const mapped = page.items.map((doc) => ({
        ...doc,
        relationship: 'collaborator' as const,
      }));
      const updatedSharedWithMeDocuments = mergeUniqueDocuments(sharedWithMeDocuments, mapped);

      void ensureCloudDocsCachedLocally(
        page.items,
        isAuthenticated,
        accessToken,
        isCloudUnavailable,
        cacheSyncInFlight
      );

      return {
        sharedWithMeDocuments: updatedSharedWithMeDocuments,
        sharedWithMeHasMore: page.hasMore,
        nextSharedPage: nextSharedPage + 1,
      };
    } catch (error) {
      let errorType: 'connectivity_error' | null = null;
      if (isConnectivityError(error)) {
        errorType = 'connectivity_error';
      }
      return {
        sharedWithMeDocuments,
        sharedWithMeHasMore: state.documentList.sharedWithMeHasMore,
        nextSharedPage,
        errorType,
      };
    }
  },
  {
    condition: (_, { getState }) => {
      const state = getState() as RootState;
      const { user, accessToken } = state.auth;
      const isAuthenticated = !!user && !!accessToken;
      const { isSharedLoading, isSharedLoadingMore, sharedWithMeHasMore } = state.documentList;
      if (
        !isAuthenticated ||
        !accessToken ||
        isSharedLoading ||
        isSharedLoadingMore ||
        !sharedWithMeHasMore
      ) {
        return false;
      }
    },
  }
);

export const loadMoreTrashDocumentsThunk = createAsyncThunk<
  {
    trashedDocuments: LocalDocumentEntry[];
    trashHasMore: boolean;
    nextTrashCloudPage: number;
    errorType?: 'connectivity_error' | null;
  },
  {
    isCloudUnavailable: boolean;
  },
  {
    state: RootState;
  }
>(
  'documentList/loadMoreTrashDocuments',
  async ({ isCloudUnavailable }, { getState }) => {
    const state = getState();
    const { accessToken } = state.auth;
    const { trashedDocuments, nextTrashCloudPage, trashHasMore } = state.documentList;

    if (isCloudUnavailable) {
      return {
        trashedDocuments,
        trashHasMore,
        nextTrashCloudPage,
      };
    }

    try {
      const page = await documentService.listCloudDocuments(
        accessToken!,
        nextTrashCloudPage,
        PAGE_SIZE,
        { trashed: true }
      );

      const seen = new Set(trashedDocuments.map((doc) => doc.id));
      const filteredDocs = page.items.filter((doc) => !seen.has(doc.id));
      const updatedTrashedDocuments = [...trashedDocuments, ...filteredDocs];

      return {
        trashedDocuments: updatedTrashedDocuments,
        trashHasMore: page.hasMore,
        nextTrashCloudPage: nextTrashCloudPage + 1,
      };
    } catch (error) {
      let errorType: 'connectivity_error' | null = null;
      if (isConnectivityError(error)) {
        errorType = 'connectivity_error';
      }
      return {
        trashedDocuments,
        trashHasMore: state.documentList.trashHasMore,
        nextTrashCloudPage,
        errorType,
      };
    }
  },
  {
    condition: ({ isCloudUnavailable }, { getState }) => {
      if (isCloudUnavailable) {
        return false;
      }
      const state = getState() as RootState;
      const { user, accessToken } = state.auth;
      const isAuthenticated = !!user && !!accessToken;
      const { isTrashLoading, isTrashLoadingMore, trashHasMore } = state.documentList;
      if (
        !isAuthenticated ||
        !accessToken ||
        isTrashLoading ||
        isTrashLoadingMore ||
        !trashHasMore
      ) {
        return false;
      }
    },
  }
);

const documentListSlice = createSlice({
  name: 'documentList',
  initialState,
  reducers: {
    updateDocumentMeta(state, action: PayloadAction<{ id: string; meta: DocumentMeta }>) {
      const { id, meta } = action.payload;

      const { entries: nextSharedWithMeDocuments, exists: existsInSharedWithMe } =
        updateDocumentMetaInList(state.sharedWithMeDocuments, id, meta);
      const { entries: nextOwnerSharedDocuments, exists: existsInOwnerShared } =
        updateDocumentMetaInList(state.ownerSharedDocuments, id, meta);
      const existsInShared = existsInSharedWithMe || existsInOwnerShared;

      if (existsInSharedWithMe) {
        state.sharedWithMeDocuments = nextSharedWithMeDocuments;
      }

      if (existsInOwnerShared) {
        state.ownerSharedDocuments = nextOwnerSharedDocuments;
      }

      const { entries: updatedPrivateDocs, exists: existsInPrivate } = updateDocumentMetaInList(
        state.documents,
        id,
        meta
      );
      const shouldInsertIntoPrivate = !existsInPrivate && !existsInShared;

      if (existsInPrivate || shouldInsertIntoPrivate) {
        const sortedPrivateDocs = shouldInsertIntoPrivate
          ? sortByUpdatedAtDesc([{ id, meta }, ...state.documents])
          : updatedPrivateDocs;

        state.documents = state.isShowingAll
          ? sortedPrivateDocs
          : sortedPrivateDocs.slice(0, INITIAL_DOCS_COUNT);
      }

      const existsLocally = state.localAllDocs.some((doc) => doc.id === id);
      if (existsLocally || shouldInsertIntoPrivate) {
        state.localAllDocs = sortByUpdatedAtDesc(
          existsLocally
            ? state.localAllDocs.map((doc) => (doc.id === id ? { ...doc, meta } : doc))
            : [{ id, meta }, ...state.localAllDocs]
        );
      }
    },

    resetOnAuthTransition(state, action: PayloadAction<{ isAuthenticated: boolean }>) {
      state.localAllDocs = [];
      state.localLoadedCount = 0;
      state.nextCloudPage = 0;
      if (!action.payload.isAuthenticated) {
        state.sharedWithMeDocuments = [];
        state.ownerSharedDocuments = [];
        state.ownerSharedHasMore = false;
        state.isSharedLoading = false;
        state.isSharedLoadingMore = false;
        state.sharedWithMeHasMore = false;
        state.isShowingAllShared = false;
        state.nextSharedPage = 0;
        state.trashedDocuments = [];
        state.trashHasMore = false;
        state.isTrashLoading = false;
        state.isTrashLoadingMore = false;
      }
    },

    setShowingAll(state, action: PayloadAction<boolean>) {
      state.isShowingAll = action.payload;
    },

    setShowingAllShared(state, action: PayloadAction<boolean>) {
      state.isShowingAllShared = action.payload;
    },
  },
  extraReducers: (builder) => {
    // fetchDocumentsThunk
    builder
      .addCase(fetchDocumentsThunk.pending, (state, action) => {
        const showLoading = action.meta.arg.showLoading ?? true;
        if (showLoading) {
          state.isLoading = true;
        }
        state.isLoadingMore = false;
      })
      .addCase(fetchDocumentsThunk.fulfilled, (state, action) => {
        state.documents = action.payload.documents;
        state.ownerSharedDocuments = action.payload.ownerSharedDocuments;
        state.hasMore = action.payload.hasMore;
        state.ownerSharedHasMore = action.payload.ownerSharedHasMore;
        state.isShowingAll = action.payload.isShowingAll;
        state.nextCloudPage = action.payload.nextCloudPage;
        state.isLoading = false;

        if (action.payload.degradedToLocal) {
          if (action.payload.localAllDocs) {
            state.localAllDocs = action.payload.localAllDocs;
          }
          if (action.payload.localLoadedCount !== undefined) {
            state.localLoadedCount = action.payload.localLoadedCount;
          }
          state.isSharedLoading = false;
          state.isSharedLoadingMore = false;
        }
      })
      .addCase(fetchDocumentsThunk.rejected, (state) => {
        state.isLoading = false;
      });

    // fetchSharedDocumentsThunk
    builder
      .addCase(fetchSharedDocumentsThunk.pending, (state, action) => {
        const showLoading = action.meta.arg.showLoading ?? true;
        if (showLoading) {
          state.isSharedLoading = true;
        }
        state.isSharedLoadingMore = false;
      })
      .addCase(fetchSharedDocumentsThunk.fulfilled, (state, action) => {
        state.sharedWithMeDocuments = action.payload.sharedWithMeDocuments;
        state.sharedWithMeHasMore = action.payload.sharedWithMeHasMore;
        state.nextSharedPage = action.payload.nextSharedPage;
        state.isSharedLoading = false;
      })
      .addCase(fetchSharedDocumentsThunk.rejected, (state) => {
        state.isSharedLoading = false;
      });

    // fetchTrashDocumentsThunk
    builder
      .addCase(fetchTrashDocumentsThunk.pending, (state) => {
        state.isTrashLoading = true;
        state.isTrashLoadingMore = false;
      })
      .addCase(fetchTrashDocumentsThunk.fulfilled, (state, action) => {
        state.trashedDocuments = action.payload.trashedDocuments;
        state.trashHasMore = action.payload.trashHasMore;
        state.nextTrashCloudPage = action.payload.nextTrashCloudPage;
        state.isTrashLoading = false;
      })
      .addCase(fetchTrashDocumentsThunk.rejected, (state) => {
        state.isTrashLoading = false;
      });

    // loadMoreDocumentsThunk
    builder
      .addCase(loadMoreDocumentsThunk.pending, (state) => {
        state.isLoadingMore = true;
      })
      .addCase(loadMoreDocumentsThunk.fulfilled, (state, action) => {
        state.documents = action.payload.documents;
        state.hasMore = action.payload.hasMore;
        state.isLoadingMore = false;

        if (action.payload.ownerSharedDocuments) {
          state.ownerSharedDocuments = action.payload.ownerSharedDocuments;
        }
        if (action.payload.ownerSharedHasMore !== undefined) {
          state.ownerSharedHasMore = action.payload.ownerSharedHasMore;
        }
        if (action.payload.nextCloudPage !== undefined) {
          state.nextCloudPage = action.payload.nextCloudPage;
        }
        if (action.payload.localLoadedCount !== undefined) {
          state.localLoadedCount = action.payload.localLoadedCount;
        }
      })
      .addCase(loadMoreDocumentsThunk.rejected, (state) => {
        state.isLoadingMore = false;
      });

    // loadMoreSharedDocumentsThunk
    builder
      .addCase(loadMoreSharedDocumentsThunk.pending, (state) => {
        state.isSharedLoadingMore = true;
      })
      .addCase(loadMoreSharedDocumentsThunk.fulfilled, (state, action) => {
        state.sharedWithMeDocuments = action.payload.sharedWithMeDocuments;
        state.sharedWithMeHasMore = action.payload.sharedWithMeHasMore;
        state.nextSharedPage = action.payload.nextSharedPage;
        state.isSharedLoadingMore = false;
      })
      .addCase(loadMoreSharedDocumentsThunk.rejected, (state) => {
        state.isSharedLoadingMore = false;
      });

    // loadMoreTrashDocumentsThunk
    builder
      .addCase(loadMoreTrashDocumentsThunk.pending, (state) => {
        state.isTrashLoadingMore = true;
      })
      .addCase(loadMoreTrashDocumentsThunk.fulfilled, (state, action) => {
        state.trashedDocuments = action.payload.trashedDocuments;
        state.trashHasMore = action.payload.trashHasMore;
        state.nextTrashCloudPage = action.payload.nextTrashCloudPage;
        state.isTrashLoadingMore = false;
      })
      .addCase(loadMoreTrashDocumentsThunk.rejected, (state) => {
        state.isTrashLoadingMore = false;
      });
  },
});

export const { updateDocumentMeta, resetOnAuthTransition, setShowingAll, setShowingAllShared } =
  documentListSlice.actions;

export default documentListSlice.reducer;
