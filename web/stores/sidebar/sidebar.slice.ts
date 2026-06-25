import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DocumentsPanelMode, DocActionsAnchor } from '@/components/sidebar/types';

export interface SidebarState {
  isCollapsed: boolean;
  panelMode: DocumentsPanelMode;
  searchQuery: string;
  isPrivateOpen: boolean;
  isSharedOpen: boolean;
  docActionsAnchor: DocActionsAnchor | null;
}

const initialState: SidebarState = {
  isCollapsed: false,
  panelMode: null,
  searchQuery: '',
  isPrivateOpen: true,
  isSharedOpen: true,
  docActionsAnchor: null,
};

const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    toggleCollapsed(state) {
      state.isCollapsed = !state.isCollapsed;
    },
    setCollapsed(state, action: PayloadAction<boolean>) {
      state.isCollapsed = action.payload;
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
    setDocActionsAnchor(state, action: PayloadAction<DocActionsAnchor | null>) {
      state.docActionsAnchor = action.payload;
    },
    resetSidebar(state) {
      state.panelMode = null;
      state.searchQuery = '';
      state.docActionsAnchor = null;
    },
  },
});

export const {
  toggleCollapsed,
  setCollapsed,
  setPanelMode,
  setSearchQuery,
  togglePrivateOpen,
  toggleSharedOpen,
  setDocActionsAnchor,
  resetSidebar,
} = sidebarSlice.actions;

export default sidebarSlice.reducer;
