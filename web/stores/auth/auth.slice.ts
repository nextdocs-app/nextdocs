import {
  createSlice,
  createAsyncThunk,
  createListenerMiddleware,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type {
  AuthState,
  LoginCredentials,
  RegisterCredentials,
  AuthApiResponse,
} from './auth.types';
import { authApiService, ApiError } from '@/services/auth.service';
import { attachmentService } from '@/services/attachment.service';
import { clearLocalUserData } from '@/lib/idb-isolation.util';
import { indexedDBService } from '@/services/indexed-db.service';
import { documentService } from '@/services/document.service';

export const AUTH_SESSION_STORAGE_KEY = 'nextdocs.auth.session';
export const SILENT_REFRESH_MIN_INTERVAL_MS = 30_000;

interface PersistedAuthSnapshot {
  user: AuthState['user'];
  accessToken: string;
  expiresAt: number;
}

function readPersistedAuthSnapshot(): PersistedAuthSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAuthSnapshot>;
    if (!parsed || !parsed.user || typeof parsed.accessToken !== 'string') {
      return null;
    }

    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return null;
    }

    return {
      user: parsed.user,
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function persistAuthSnapshot(state: AuthState): void {
  if (
    typeof window === 'undefined' ||
    !state.user ||
    !state.accessToken ||
    state.expiresAt === null
  ) {
    return;
  }

  const payload: PersistedAuthSnapshot = {
    user: state.user,
    accessToken: state.accessToken,
    expiresAt: state.expiresAt,
  };

  window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function clearPersistedAuthSnapshot(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

const persistedAuth = readPersistedAuthSnapshot();
indexedDBService.setUserId(persistedAuth?.user?.id ?? null);

const initialState: AuthState = {
  user: persistedAuth?.user ?? null,
  accessToken: persistedAuth?.accessToken ?? null,
  expiresAt: persistedAuth?.expiresAt ?? null,
  lastAuthAction: null,
  lastSilentRefreshAt: null,
  isLoading: false,
  isInitializing: true,
  error: null,
};

export const loginThunk = createAsyncThunk<AuthApiResponse, LoginCredentials>(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await authApiService.login(credentials);
      // A signed URL cached for a previous session must never leak into this one.
      attachmentService.resetAttachmentUrlCache();
      indexedDBService.setUserId(response.user.id);
      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed.';
      return rejectWithValue(message);
    }
  }
);

export const registerThunk = createAsyncThunk<AuthApiResponse, RegisterCredentials>(
  'auth/register',
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await authApiService.register(credentials);
      // A signed URL cached for a previous session must never leak into this one.
      attachmentService.resetAttachmentUrlCache();
      indexedDBService.setUserId(response.user.id);
      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed.';
      return rejectWithValue(message);
    }
  }
);

export const refreshSessionThunk = createAsyncThunk<
  AuthApiResponse,
  void,
  { state: { auth: AuthState } }
>(
  'auth/refresh',
  async (_, { rejectWithValue }) => {
    try {
      const response = await authApiService.refresh();
      indexedDBService.setUserId(response.user.id);
      return response;
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        attachmentService.resetAttachmentUrlCache();
        await clearLocalUserData();
        indexedDBService.setUserId(null);
        return rejectWithValue('unauthorized');
      }
      return rejectWithValue('failed');
    }
  },
  {
    condition: (_, { getState }) => {
      const { auth } = getState();
      if (
        auth.lastSilentRefreshAt != null &&
        Date.now() - auth.lastSilentRefreshAt < SILENT_REFRESH_MIN_INTERVAL_MS
      ) {
        return false;
      }
      return true;
    },
  }
);

export const logoutThunk = createAsyncThunk<void, void, { state: { auth: AuthState } }>(
  'auth/logout',
  async (_, { getState }) => {
    const accessToken = getState().auth.accessToken ?? undefined;
    // Best-effort: revoke the server-side refresh token. Swallow errors so the
    // client-side state is always cleared regardless of API reachability.
    try {
      await authApiService.logout(accessToken);
    } catch {
      // ignore
    }
    attachmentService.resetAttachmentUrlCache();
    await clearLocalUserData();
    indexedDBService.setUserId(null);
    documentService.clearSessionRegistries();
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuthFromResponse(state, action: PayloadAction<AuthApiResponse>) {
      const { user, accessToken, expiresIn } = action.payload;
      state.user = user;
      state.accessToken = accessToken;
      state.expiresAt = Date.now() + expiresIn * 1000;
      state.lastAuthAction = null;
      state.error = null;
    },
    clearAuth(state) {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.lastAuthAction = null;
      state.lastSilentRefreshAt = null;
      state.error = null;
    },
    clearError(state) {
      state.error = null;
    },
    setInitializing(state, action: PayloadAction<boolean>) {
      state.isInitializing = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginThunk.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginThunk.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.expiresAt = Date.now() + action.payload.expiresIn * 1000;
        state.lastAuthAction = 'login';
        state.error = null;
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.isLoading = false;
        state.error = (action.payload as string) ?? 'Login failed.';
      });

    builder
      .addCase(registerThunk.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(registerThunk.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.expiresAt = Date.now() + action.payload.expiresIn * 1000;
        state.lastAuthAction = 'register';
        state.error = null;
      })
      .addCase(registerThunk.rejected, (state, action) => {
        state.isLoading = false;
        state.error = (action.payload as string) ?? 'Registration failed.';
      });

    builder
      .addCase(refreshSessionThunk.pending, (state) => {
        state.error = null;
      })
      .addCase(refreshSessionThunk.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.expiresAt = Date.now() + action.payload.expiresIn * 1000;
        state.lastAuthAction = null;
        // Stamp the coalescing window on success only: a failed attempt must
        // stay retryable, or a transient error would leave the session expired
        // for the rest of the interval.
        state.lastSilentRefreshAt = Date.now();
        if (state.isInitializing) {
          state.isInitializing = false;
        }
      })
      .addCase(refreshSessionThunk.rejected, (state, action) => {
        // A `condition` abort is not a failed refresh: the throttle window
        // stays intact so the next dispatch outside the interval still
        // coalesces correctly instead of firing on every-other call.
        if (action.meta?.condition) {
          return;
        }
        state.lastSilentRefreshAt = null;
        if (action.payload === 'unauthorized') {
          state.user = null;
          state.accessToken = null;
          state.expiresAt = null;
          state.lastAuthAction = null;
          state.lastSilentRefreshAt = null;
        }
        if (state.isInitializing) {
          state.isInitializing = false;
        }
      });

    builder.addCase(logoutThunk.fulfilled, (state) => {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.lastAuthAction = null;
      state.lastSilentRefreshAt = null;
      state.error = null;
    });
  },
});

export const { setAuthFromResponse, clearAuth, clearError, setInitializing } = authSlice.actions;
export default authSlice.reducer;

// Session side effects live here, not in reducers: guest link mirrors must
// not leak into the signed-in session, and snapshots belong in storage.
export const authListenerMiddleware = createListenerMiddleware();
authListenerMiddleware.startListening({
  actionCreator: setAuthFromResponse,
  effect: async (_action, listenerApi) => {
    // A guest link signing in is an identity switch too, not just the thunks below.
    attachmentService.resetAttachmentUrlCache();
    documentService.clearSessionRegistries();
    persistAuthSnapshot((listenerApi.getState() as { auth: AuthState }).auth);
  },
});
authListenerMiddleware.startListening({
  actionCreator: clearAuth,
  effect: async () => {
    attachmentService.resetAttachmentUrlCache();
    clearPersistedAuthSnapshot();
    documentService.clearSessionRegistries();
  },
});
authListenerMiddleware.startListening({
  predicate: (action) =>
    loginThunk.fulfilled.match(action) ||
    registerThunk.fulfilled.match(action) ||
    refreshSessionThunk.fulfilled.match(action),
  effect: async (_action, listenerApi) => {
    documentService.clearSessionRegistries();
    persistAuthSnapshot((listenerApi.getState() as { auth: AuthState }).auth);
  },
});
authListenerMiddleware.startListening({
  predicate: (action) =>
    logoutThunk.fulfilled.match(action) ||
    (refreshSessionThunk.rejected.match(action) && action.payload === 'unauthorized'),
  effect: async () => {
    clearPersistedAuthSnapshot();
  },
});
