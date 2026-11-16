import type { DocumentAccessLevel } from '@/services/document.service';
import type { DocumentMeta } from '@/types/document.types';

export interface LocalDocumentEntry {
  id: string;
  meta: DocumentMeta;
  /** Personal navigation order key from the server (null for nested documents). */
  orderKey?: string | null;
  /** Real parent in the owning user's tree (null for root-level documents). */
  parentId?: string | null;
  /** Whether this document has external collaborators. */
  hasCollaborators?: boolean;
  /** Document access level for the current user. */
  accessLevel?: DocumentAccessLevel | null;
  /** Whether the current user owns the document; an OWNER-level grant is not ownership. */
  owner?: boolean;
}

export interface SharedDocumentEntry extends LocalDocumentEntry {
  /**
   * Whether the entry is the current user's own page, derived from the server's
   * ownership flag and never from `accessLevel`: a collaborator can hold an
   * OWNER-level grant, and treating that as ownership hides their shared page.
   */
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
  isSharedLoading: boolean;
  isSharedLoadingMore: boolean;
  sharedWithMeHasMore: boolean;
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
