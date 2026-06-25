import type { DocumentMeta } from '@/types/document.types';

export interface LocalDocumentEntry {
  id: string;
  meta: DocumentMeta;
}

export interface SharedDocumentEntry extends LocalDocumentEntry {
  relationship: 'owner' | 'collaborator';
}

export interface DocumentListState {
  // Private documents
  documents: LocalDocumentEntry[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  isShowingAll: boolean;

  // Shared documents
  sharedWithMeDocuments: SharedDocumentEntry[];
  ownerSharedDocuments: SharedDocumentEntry[];
  isSharedLoading: boolean;
  isSharedLoadingMore: boolean;
  sharedWithMeHasMore: boolean;
  ownerSharedHasMore: boolean;
  isShowingAllShared: boolean;

  // Trashed documents
  trashedDocuments: LocalDocumentEntry[];
  isTrashLoading: boolean;
  isTrashLoadingMore: boolean;
  trashHasMore: boolean;

  // Pagination page numbers (was nextCloudPageRef, etc.)
  nextCloudPage: number;
  nextSharedPage: number;
  nextTrashCloudPage: number;

  // Local IDB pagination
  localLoadedCount: number;
  localAllDocs: LocalDocumentEntry[];
}
