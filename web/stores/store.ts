import { configureStore } from '@reduxjs/toolkit';
import documentReducer from './document/document.slice';
import authReducer from './auth/auth.slice';

export const store = configureStore({
  reducer: {
    document: documentReducer,
    auth: authReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
