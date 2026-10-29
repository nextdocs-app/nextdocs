import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SettingsEntryId } from '@/components/settings/types';

/** Which trigger opened settings, so focus returns to the same control. */
export type SettingsDialogSource = 'account' | 'workspace';

export interface UiState {
  isSettingsDialogOpen: boolean;
  settingsDialogEntryId: SettingsEntryId | null;
  settingsDialogSource: SettingsDialogSource | null;
  isAccountMenuOpen: boolean;
  isWorkspaceMenuOpen: boolean;

  // Permanent delete target
  permanentDeleteTarget: {
    id: string;
    title: string;
  } | null;
}

const initialState: UiState = {
  isSettingsDialogOpen: false,
  settingsDialogEntryId: null,
  settingsDialogSource: null,
  isAccountMenuOpen: false,
  isWorkspaceMenuOpen: false,
  permanentDeleteTarget: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openSettingsDialog(
      state,
      action: PayloadAction<{ entryId?: SettingsEntryId; source: SettingsDialogSource }>
    ) {
      state.isSettingsDialogOpen = true;
      state.settingsDialogEntryId = action.payload.entryId ?? null;
      state.settingsDialogSource = action.payload.source;
    },
    closeSettingsDialog(state) {
      state.isSettingsDialogOpen = false;
      state.settingsDialogEntryId = null;
      state.settingsDialogSource = null;
    },
    setAccountMenuOpen(state, action: PayloadAction<boolean>) {
      state.isAccountMenuOpen = action.payload;
    },
    setWorkspaceMenuOpen(state, action: PayloadAction<boolean>) {
      state.isWorkspaceMenuOpen = action.payload;
    },
    setPermanentDeleteTarget(state, action: PayloadAction<{ id: string; title: string } | null>) {
      state.permanentDeleteTarget = action.payload;
    },
  },
});

export const {
  openSettingsDialog,
  closeSettingsDialog,
  setAccountMenuOpen,
  setWorkspaceMenuOpen,
  setPermanentDeleteTarget,
} = uiSlice.actions;

export default uiSlice.reducer;
