import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DocumentsPanelMode, DocActionsAnchor } from '@/components/sidebar/types';
import type { SidebarUiPreferences } from '@/lib/sidebar-preferences.util';

export interface SidebarState {
  /** Desktop only: the rail is fully closed and the shell shows its opener. */
  isCollapsed: boolean;
  panelMode: DocumentsPanelMode;
  searchQuery: string;
  isPrivateOpen: boolean;
  isSharedOpen: boolean;
  isSpacesOpen: boolean;
  /**
   * Spaces whose documents are unfolded. Ordered oldest-first so the persisted
   * list can be capped from the front; see `mergeExpandedIds`.
   */
  expandedSpaceIds: string[];
  docActionsAnchor: DocActionsAnchor | null;
  /**
   * Mobile only: whether the off-canvas navigation drawer is showing. Kept
   * separate from `isCollapsed` so closing the rail on desktop does not decide
   * whether the drawer is open on a phone, and vice versa.
   */
  isMobileNavOpen: boolean;
}

const initialState: SidebarState = {
  isCollapsed: false,
  panelMode: null,
  searchQuery: '',
  isPrivateOpen: true,
  isSharedOpen: true,
  isSpacesOpen: true,
  expandedSpaceIds: [],
  docActionsAnchor: null,
  isMobileNavOpen: false,
};

const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    setCollapsed(state, action: PayloadAction<boolean>) {
      state.isCollapsed = action.payload;
    },
    /**
     * Adopts the stored rail state in one dispatch. The store itself is never
     * seeded from storage: it is a module singleton shared with SSR, so the
     * value can only come from a client effect (or another tab).
     */
    hydratePreferences(state, action: PayloadAction<SidebarUiPreferences>) {
      const { collapsed, sections } = action.payload;
      state.isCollapsed = collapsed;
      state.isSpacesOpen = sections.spaces;
      state.isPrivateOpen = sections.private;
      state.isSharedOpen = sections.shared;
    },
    setMobileNavOpen(state, action: PayloadAction<boolean>) {
      state.isMobileNavOpen = action.payload;
    },
    toggleMobileNav(state) {
      state.isMobileNavOpen = !state.isMobileNavOpen;
    },
    setPanelMode(state, action: PayloadAction<DocumentsPanelMode>) {
      state.panelMode = action.payload;
    },
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },
    togglePrivateOpen(state) {
      state.isPrivateOpen = !state.isPrivateOpen;
    },
    toggleSharedOpen(state) {
      state.isSharedOpen = !state.isSharedOpen;
    },
    toggleSpacesOpen(state) {
      state.isSpacesOpen = !state.isSpacesOpen;
    },
    setSpaceExpanded(state, action: PayloadAction<{ spaceId: string; expanded: boolean }>) {
      const { spaceId, expanded } = action.payload;
      const isExpanded = state.expandedSpaceIds.indexOf(spaceId) >= 0;
      if (isExpanded === expanded) {
        return;
      }
      state.expandedSpaceIds = expanded
        ? [...state.expandedSpaceIds, spaceId]
        : state.expandedSpaceIds.filter((id) => id !== spaceId);
    },
    /**
     * Drops unfolded-space ids on a logout or account switch. They are scoped
     * to an identity by the preference key, so carrying them into the next
     * session would persist them under the new account.
     */
    clearExpandedSpaces(state) {
      state.expandedSpaceIds = [];
    },
    setDocActionsAnchor(state, action: PayloadAction<DocActionsAnchor | null>) {
      state.docActionsAnchor = action.payload;
    },
    /**
     * Drops the transient surfaces only. Collapse, section and expansion state
     * are remembered preferences and deliberately survive a reset, so a
     * destructive action cannot quietly rewrite what the user chose to keep open.
     */
    resetSidebar(state) {
      state.panelMode = null;
      state.searchQuery = '';
      state.docActionsAnchor = null;
      state.isMobileNavOpen = false;
    },
  },
});

export const {
  setCollapsed,
  setMobileNavOpen,
  toggleMobileNav,
  setPanelMode,
  setSearchQuery,
  togglePrivateOpen,
  toggleSharedOpen,
  toggleSpacesOpen,
  setDocActionsAnchor,
  setSpaceExpanded,
  clearExpandedSpaces,
  hydratePreferences,
  resetSidebar,
} = sidebarSlice.actions;

export default sidebarSlice.reducer;
