import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DocumentsPanelMode, DocActionsAnchor } from '@/components/sidebar/types';

export interface SidebarState {
  /** Desktop only: the rail is fully closed and the shell shows its opener. */
  isCollapsed: boolean;
  sidebarWidth: number;
  panelMode: DocumentsPanelMode;
  searchQuery: string;
  isPrivateOpen: boolean;
  isSharedOpen: boolean;
  isSpacesOpen: boolean;
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
  sidebarWidth: 256,
  panelMode: null,
  searchQuery: '',
  isPrivateOpen: true,
  isSharedOpen: true,
  isSpacesOpen: true,
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
    setMobileNavOpen(state, action: PayloadAction<boolean>) {
      state.isMobileNavOpen = action.payload;
    },
    toggleMobileNav(state) {
      state.isMobileNavOpen = !state.isMobileNavOpen;
    },
    setSidebarWidth(state, action: PayloadAction<number>) {
      state.sidebarWidth = action.payload;
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
    setDocActionsAnchor(state, action: PayloadAction<DocActionsAnchor | null>) {
      state.docActionsAnchor = action.payload;
    },
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
  setSidebarWidth,
  setPanelMode,
  setSearchQuery,
  togglePrivateOpen,
  toggleSharedOpen,
  toggleSpacesOpen,
  setDocActionsAnchor,
  resetSidebar,
} = sidebarSlice.actions;

export default sidebarSlice.reducer;
