import { configureStore } from '@reduxjs/toolkit';
import documentReducer from './document/document.slice';
import authReducer, { authListenerMiddleware } from './auth/auth.slice';
import documentListReducer from './documentList/documentList.slice';
import sidebarReducer from './sidebar/sidebar.slice';
import sidebarTreeReducer from './sidebarTree/sidebarTree.slice';
import sharedTreeReducer from './sharedTree/sharedTree.slice';
import spaceTreeReducer from './spaceTree/spaceTree.slice';
import uiReducer from './ui/ui.slice';
import themeReducer from './theme/theme.slice';
import toastsReducer from './toasts/toasts.slice';

export const store = configureStore({
  reducer: {
    document: documentReducer,
    auth: authReducer,
    documentList: documentListReducer,
    sidebar: sidebarReducer,
    sidebarTree: sidebarTreeReducer,
    sharedTree: sharedTreeReducer,
    spaceTree: spaceTreeReducer,
    ui: uiReducer,
    theme: themeReducer,
    toasts: toastsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActionPaths: ['meta.arg.cacheSyncInFlight'],
      },
    }).prepend(authListenerMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
