import type { LocalDocumentEntry, SharedDocumentEntry } from '@/hooks/useDocumentList.hook';
import type { MenuRect } from '@/lib/menu-position.util';

export type DocumentsPanelMode = 'all' | 'shared' | 'trash' | null;

export type DocActionType = 'move-to-trash' | 'leave-shared';

export type DocActionsAnchor = {
  documentId: string;
  actionType: DocActionType;
  /** Trigger button rect (viewport coordinates) captured when it was clicked. */
  trigger: MenuRect;
  /**
   * Right edge of the sidebar the trigger sits in. Desktop menus are centred on
   * it (half over the rail, half over the page) while mobile menus open to the
   * right of it and let the viewport clamp hold them on screen. `null` when the
   * panel could not be measured, in which case the trigger's own edge is used.
   */
  panelEdgeX: number | null;
};

export type SidebarSectionDocument = LocalDocumentEntry | SharedDocumentEntry;

export const SIDEBAR_VISIBLE_COUNT = 7;
