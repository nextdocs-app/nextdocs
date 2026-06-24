import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { StoredDocument } from '@/types/document.types';

export interface UiState {
  isAuthModalOpen: boolean;
  isSettingsModalOpen: boolean;
  isAccountMenuOpen: boolean;

  // Permanent delete target
  permanentDeleteTarget: {
    id: string;
    title: string;
  } | null;

  // Local docs promotion flow
  isLocalDocsModalOpen: boolean;
  localDocsToPromote: StoredDocument[];
  isImportingLocalDocs: boolean;
  localDocsError: string | null;
  isRegistrationSyncOverlayOpen: boolean;
}

const initialState: UiState = {
  isAuthModalOpen: false,
  isSettingsModalOpen: false,
  isAccountMenuOpen: false,
  permanentDeleteTarget: null,
  isLocalDocsModalOpen: false,
  localDocsToPromote: [],
  isImportingLocalDocs: false,
  localDocsError: null,
  isRegistrationSyncOverlayOpen: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setAuthModalOpen(state, action: PayloadAction<boolean>) {
      state.isAuthModalOpen = action.payload;
    },
    setSettingsModalOpen(state, action: PayloadAction<boolean>) {
      state.isSettingsModalOpen = action.payload;
    },
    setAccountMenuOpen(state, action: PayloadAction<boolean>) {
      state.isAccountMenuOpen = action.payload;
    },
    setPermanentDeleteTarget(state, action: PayloadAction<{ id: string; title: string } | null>) {
      state.permanentDeleteTarget = action.payload;
    },
    setLocalDocsModalOpen(state, action: PayloadAction<boolean>) {
      state.isLocalDocsModalOpen = action.payload;
    },
    setLocalDocsToPromote(state, action: PayloadAction<StoredDocument[]>) {
      state.localDocsToPromote = action.payload;
    },
    setImportingLocalDocs(state, action: PayloadAction<boolean>) {
      state.isImportingLocalDocs = action.payload;
    },
    setLocalDocsError(state, action: PayloadAction<string | null>) {
      state.localDocsError = action.payload;
    },
    setRegistrationSyncOverlayOpen(state, action: PayloadAction<boolean>) {
      state.isRegistrationSyncOverlayOpen = action.payload;
    },
    resetPromotionFlow(state) {
      state.isLocalDocsModalOpen = false;
      state.localDocsToPromote = [];
      state.isImportingLocalDocs = false;
      state.localDocsError = null;
      state.isRegistrationSyncOverlayOpen = false;
    },
  },
});

export const {
  setAuthModalOpen,
  setSettingsModalOpen,
  setAccountMenuOpen,
  setPermanentDeleteTarget,
  setLocalDocsModalOpen,
  setLocalDocsToPromote,
  setImportingLocalDocs,
  setLocalDocsError,
  setRegistrationSyncOverlayOpen,
  resetPromotionFlow,
} = uiSlice.actions;

export default uiSlice.reducer;
