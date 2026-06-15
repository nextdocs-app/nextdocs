import type { LocalDocumentEntry, SharedDocumentEntry } from '@/hooks/useDocumentList.hook';

export type DocumentsPanelMode = 'all' | 'shared' | 'trash' | null;

export type DocActionType = 'move-to-trash' | 'leave-shared';

export type DocActionsAnchor = {
  documentId: string;
  actionType: DocActionType;
  x: number;
  y: number;
};

export type SidebarSectionDocument = LocalDocumentEntry | SharedDocumentEntry;

export const SIDEBAR_VISIBLE_COUNT = 7;
