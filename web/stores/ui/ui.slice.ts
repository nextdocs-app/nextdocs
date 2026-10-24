import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface UiState {
  isSettingsModalOpen: boolean;
  isAccountMenuOpen: boolean;

  // Permanent delete target
  permanentDeleteTarget: {
    id: string;
    title: string;
  } | null;
}

const initialState: UiState = {
  isSettingsModalOpen: false,
  isAccountMenuOpen: false,
  permanentDeleteTarget: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSettingsModalOpen(state, action: PayloadAction<boolean>) {
      state.isSettingsModalOpen = action.payload;
    },
    setAccountMenuOpen(state, action: PayloadAction<boolean>) {
      state.isAccountMenuOpen = action.payload;
    },
    setPermanentDeleteTarget(state, action: PayloadAction<{ id: string; title: string } | null>) {
      state.permanentDeleteTarget = action.payload;
    },
  },
});

export const { setSettingsModalOpen, setAccountMenuOpen, setPermanentDeleteTarget } =
  uiSlice.actions;

export default uiSlice.reducer;
