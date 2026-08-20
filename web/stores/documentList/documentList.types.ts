import type { DocumentAccessLevel } from '@/services/document.service';
import type { DocumentMeta } from '@/types/document.types';

export interface LocalDocumentEntry {
  id: string;
  meta: DocumentMeta;
  /** Personal navigation order key from the server (null for nested documents). */
  orderKey?: string | null;
  /** Real parent in the owning user's tree (null for root-level documents). */
  parentId?: string | null;
  /** Document access level for the current user. */
  accessLevel?: DocumentAccessLevel | null;
}

export interface SharedDocumentEntry extends LocalDocumentEntry {
  relationship: 'owner' | 'collaborator';
  /** Real parent in the owning user's tree (null for root-level documents). */
  parentId: string | null;
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
