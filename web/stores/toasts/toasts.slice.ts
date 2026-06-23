import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export interface ToastsState {
  toasts: Toast[];
}

const initialState: ToastsState = {
  toasts: [],
};

const toastsSlice = createSlice({
  name: 'toasts',
  initialState,
  reducers: {
    addToast(state, action: PayloadAction<Omit<Toast, 'id'>>) {
      const id = Math.random().toString(36).substring(2, 9);
      state.toasts.push({
        id,
        duration: 4000,
        ...action.payload,
      });
    },
    removeToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const { addToast, removeToast } = toastsSlice.actions;
export default toastsSlice.reducer;
