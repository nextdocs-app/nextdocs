import { configureStore } from '@reduxjs/toolkit';
import documentReducer from './document/document.slice';
import authReducer from './auth/auth.slice';
import documentListReducer from './documentList/documentList.slice';
import sidebarReducer from './sidebar/sidebar.slice';
import uiReducer from './ui/ui.slice';
import themeReducer from './theme/theme.slice';
import toastsReducer from './toasts/toasts.slice';

export const store = configureStore({
  reducer: {
    document: documentReducer,
    auth: authReducer,
    documentList: documentListReducer,
    sidebar: sidebarReducer,
    ui: uiReducer,
    theme: themeReducer,
    toasts: toastsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['ui/setLocalDocsToPromote'],
        ignoredActionPaths: ['payload.localDocsToPromote', 'meta.arg.cacheSyncInFlight'],
        ignoredPaths: ['ui.localDocsToPromote'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
