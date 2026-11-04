import type { DocumentAccessLevel } from '@/services/document.service';
import type { DocumentIcon } from '@/types/document.types';

/**
 * Absent-value convention across the tree layer.
 *
 * `DocumentMeta` (domain) omits the key (`icon?: DocumentIcon` — undefined
 * means "no icon"). Tree nodes normalize to an explicit null at the boundary
 * (`?? null` in `toSidebarTreeNode`, the service mappers, and
 * `syncSharedRoots`); readers treat a missing key and null identically as
 * "no icon" and must not re-apply `?? null` on values that are already
 * `DocumentIcon | null | undefined`.
 */
export interface TreeNode {
  id: string;
  title: string;
  parentId: string | null;
  orderKey: string;
  hasChildren: boolean;
  hasCollaborators?: boolean;
  effectiveAccessLevel: DocumentAccessLevel | null;
  createdAt: string;
  updatedAt: string;
  icon?: DocumentIcon | null;
}

export interface TreeNodePage {
  items: TreeNode[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasMore: boolean;
}

export interface MoveDocumentRequest {
  newParentId: string | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
}

export interface SidebarTreeNode {
  id: string;
  title: string;
  parentId: string | null;
  orderKey: string;
  hasChildren: boolean;
  hasCollaborators?: boolean;
  effectiveAccessLevel: DocumentAccessLevel | null;
  icon?: DocumentIcon | null;
  isExpanded: boolean;
  isLoading: boolean;
  children: string[];
  childrenLoaded: boolean;
  /**
   * True when the child list was capped client-side (guest public children
   * stop after MAX_PUBLIC_CHILDREN_PAGES) while the server reports more.
   * The list looks complete otherwise, so the tree renders a hint.
   */
  childrenTruncated?: boolean;
  createdAt: string;
  updatedAt: string;
}
