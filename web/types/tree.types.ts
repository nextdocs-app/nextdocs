import type { DocumentAccessLevel } from '@/services/document.service';

export interface TreeNode {
  id: string;
  title: string;
  parentId: string | null;
  orderKey: string;
  hasChildren: boolean;
  effectiveAccessLevel: DocumentAccessLevel | null;
  createdAt: string;
  updatedAt: string;
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
  effectiveAccessLevel: DocumentAccessLevel | null;
  isExpanded: boolean;
  isLoading: boolean;
  children: string[];
  childrenLoaded: boolean;
  createdAt: string;
  updatedAt: string;
}
