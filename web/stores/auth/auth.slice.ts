import {
  createSlice,
  createAsyncThunk,
  createListenerMiddleware,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { AuthState } from './auth.types';
import type { AuthApiResponse, LoginCredentials, RegisterCredentials } from '@/types/auth.types';
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

    if (typeof parsed.expiresAt !== 'number') {
      return null;
    }

    // An expired access token does not mean the session is gone: the refresh
    // cookie may still restore it. Dropping the snapshot here would hide this
    // account's cached documents for the whole offline reload, so keep the
    // identity and let the refresh (or a 401) decide.

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

/** Page cache keys hold document ids, so they must not outlive the session. */
function clearCachedDocumentPages(): void {
  if (typeof navigator === 'undefined') {
    return;
  }

  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE_PAGES' });
}

const persistedAuth = readPersistedAuthSnapshot();
indexedDBService.setUserId(persistedAuth?.user?.id ?? null);

const initialState: AuthState = {
  user: persistedAuth?.user ?? null,
  accessToken: persistedAuth?.accessToken ?? null,
  expiresAt: persistedAuth?.expiresAt ?? null,
  lastSilentRefreshAt: null,
  sessionId: 0,
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

// Two rotations of the same refresh cookie make the API treat the second as
// reuse and revoke the whole session, so every dispatch shares this request
// instead of being aborted while it is in flight. The identity is part of the
// share: a rotation that outlives a logout belongs to the account that asked
// for it, and its response must never be applied to the next session.
let inFlightRefresh: {
  userId: string | null;
  sessionId: number;
  promise: Promise<AuthApiResponse>;
} | null = null;

function requestSessionRefresh(userId: string | null, sessionId: number): Promise<AuthApiResponse> {
  if (inFlightRefresh?.userId === userId && inFlightRefresh.sessionId === sessionId) {
    return inFlightRefresh.promise;
  }

  const promise = authApiService.refresh().finally(() => {
    if (inFlightRefresh?.promise === promise) {
      inFlightRefresh = null;
    }
  });
  inFlightRefresh = { userId, sessionId, promise };
  return promise;
}

function isStaleSession(state: AuthState, userId: string | null, sessionId: number): boolean {
  return (state.user?.id ?? null) !== userId || state.sessionId !== sessionId;
}

export const refreshSessionThunk = createAsyncThunk<
  AuthApiResponse,
  void,
  { state: { auth: AuthState } }
>(
  'auth/refresh',
  async (_, { getState, rejectWithValue }) => {
    const { user, sessionId } = getState().auth;
    const sessionUserId = user?.id ?? null;
    try {
      const response = await requestSessionRefresh(sessionUserId, sessionId);
      // A logout, account switch, or a fresh sign-in may have completed while
      // the request was in flight. Applying the response now would restore the
      // previous identity (and re-point IndexedDB at it) after its local data
      // was wiped, or overwrite the session that replaced it.
      const current = getState().auth;
      if (isStaleSession(current, sessionUserId, sessionId)) {
        return rejectWithValue('stale');
      }
      indexedDBService.setUserId(response.user.id);
      return response;
    } catch (err: unknown) {
      // The failure may belong to a session that was replaced while the request
      // was in flight (logout + sign-in revokes the old refresh cookie). It must
      // not sign out or re-point IndexedDB for the session that replaced it.
      const current = getState().auth;
      if (isStaleSession(current, sessionUserId, sessionId)) {
        return rejectWithValue('stale');
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        attachmentService.resetAttachmentUrlCache();
        // An expired session is not a logout: keep the account's local
        // documents and queued offline creates so they can replay after the
        // same user signs in again.
        indexedDBService.setUserId(null);
        return rejectWithValue('unauthorized');
      }
      return rejectWithValue('failed');
    }
  },
  {
    condition: (_, { getState }) => {
      const { auth } = getState();
      // A completed refresh inside the window is reused rather than repeated.
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
    clearCachedDocumentPages();
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
      state.sessionId += 1;
      state.error = null;
    },
    clearAuth(state) {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.lastSilentRefreshAt = null;
      state.sessionId += 1;
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
        state.sessionId += 1;
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
        state.sessionId += 1;
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
        // stays intact so a dispatch inside it does not refire on every call.
        // A `stale` rejection came from a session that has already been
        // replaced, so it must not clear the newer session's throttle or
        // initializing state either.
        if (action.meta?.condition || action.payload === 'stale') {
          return;
        }
        state.lastSilentRefreshAt = null;
        if (action.payload === 'unauthorized') {
          state.user = null;
          state.accessToken = null;
          state.expiresAt = null;
          state.lastSilentRefreshAt = null;
          state.sessionId += 1;
        }
        if (state.isInitializing) {
          state.isInitializing = false;
        }
      });

    builder.addCase(logoutThunk.fulfilled, (state) => {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.lastSilentRefreshAt = null;
      state.sessionId += 1;
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
