import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface UiState {
  isSettingsDialogOpen: boolean;
  isAccountMenuOpen: boolean;

  // Permanent delete target
  permanentDeleteTarget: {
    id: string;
    title: string;
  } | null;
}

const initialState: UiState = {
  isSettingsDialogOpen: false,
  isAccountMenuOpen: false,
  permanentDeleteTarget: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSettingsDialogOpen(state, action: PayloadAction<boolean>) {
      state.isSettingsDialogOpen = action.payload;
    },
    setAccountMenuOpen(state, action: PayloadAction<boolean>) {
      state.isAccountMenuOpen = action.payload;
    },
    setPermanentDeleteTarget(state, action: PayloadAction<{ id: string; title: string } | null>) {
      state.permanentDeleteTarget = action.payload;
    },
  },
});

export const { setSettingsDialogOpen, setAccountMenuOpen, setPermanentDeleteTarget } =
  uiSlice.actions;

export default uiSlice.reducer;
