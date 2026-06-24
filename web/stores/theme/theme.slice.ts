import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Theme } from '@/hooks/useTheme.hook';

export interface ThemeState {
  theme: Theme;
}

const initialState: ThemeState = {
  theme: 'system',
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeInStore(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
    },
  },
});

export const { setThemeInStore } = themeSlice.actions;
export default themeSlice.reducer;
