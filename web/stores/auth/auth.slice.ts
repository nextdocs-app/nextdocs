import { createSlice, createAsyncThunk, createListenerMiddleware } from '@reduxjs/toolkit';
import type { AuthState } from './auth.types';
import type { AuthApiResponse, AuthUser } from '@/types/auth.types';
import { authApiService, ApiError } from '@/services/auth.service';
import { profileApiService } from '@/services/profile.service';
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
  isInitializing: true,
};

// Two rotations of the same refresh cookie make the API treat the second as
// reuse and revoke the whole session, so every dispatch shares this request
// instead of being aborted while it is in flight. The identity is part of the
// share: a rotation that outlives a logout belongs to the account that asked
// for it, and its response must never be applied to the next session.
interface InFlightRefresh {
  userId: string | null;
  sessionId: number;
  /** `profileWriteCountFor` when this request was sent; every waiter shares it. */
  writesAtStart: number;
  promise: Promise<AuthApiResponse>;
}

let inFlightRefresh: InFlightRefresh | null = null;

/**
 * Bumped on every completed profile write, so a refresh can tell whose snapshot is
 * newer. Keyed by account and login: a write that outlives its session belongs to
 * the account that sent it, and must not make the next account's answer look stale.
 */
const profileWriteCounts = new Map<string, number>();

function profileWriteCountFor(userId: string | null, sessionId: number): number {
  return profileWriteCounts.get(`${userId ?? ''}:${sessionId}`) ?? 0;
}

function recordProfileWrite(userId: string, sessionId: number): void {
  const key = `${userId}:${sessionId}`;
  profileWriteCounts.set(key, profileWriteCountFor(userId, sessionId) + 1);
}

function requestSessionRefresh(
  userId: string | null,
  sessionId: number,
  isCurrent: () => boolean
): InFlightRefresh {
  if (inFlightRefresh?.userId === userId && inFlightRefresh.sessionId === sessionId) {
    return inFlightRefresh;
  }

  const writesAtStart = profileWriteCountFor(userId, sessionId);
  const promise = refreshWithRotationRetry(isCurrent, userId !== null).finally(() => {
    if (inFlightRefresh?.promise === promise) {
      inFlightRefresh = null;
    }
  });
  const shared: InFlightRefresh = { userId, sessionId, writesAtStart, promise };
  inFlightRefresh = shared;
  return shared;
}

/**
 * Retries the one 401 this tab can actually explain: a rotation that raced
 * another tab. That tab replaced the shared refresh cookie while this request
 * was in flight, and the browser jar already holds the replacement, so a second
 * attempt can recover without signing the user out.
 *
 * Only a tab that already had a session can have lost that race. A tab with no
 * known identity is asking whether a session exists at all, and retrying that
 * "no" would double every signed-out page load's refresh traffic for nothing.
 * (The server's own rotation grace answers the raced case with 200, so the retry
 * is the fallback for a refresh that raced a `Set-Cookie` write.)
 */
async function refreshWithRotationRetry(
  isCurrent: () => boolean,
  hadPriorSession: boolean
): Promise<AuthApiResponse> {
  try {
    return await authApiService.refresh();
  } catch (err) {
    if (!hadPriorSession || !(err instanceof ApiError) || err.status !== 401 || !isCurrent()) {
      throw err;
    }

    return authApiService.refresh();
  }
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
      // The baseline travels with the shared request, not with this dispatch: a
      // waiter that joined a request sent before a profile write must judge the
      // answer by that request's start, or it would accept a snapshot its own
      // start already predates and undo the rename the first waiter preserved.
      const { promise, writesAtStart } = requestSessionRefresh(
        sessionUserId,
        sessionId,
        () => !isStaleSession(getState().auth, sessionUserId, sessionId)
      );
      const response = await promise;
      // A logout, account switch, or a fresh sign-in may have completed while
      // the request was in flight. Applying the response now would restore the
      // previous identity (and re-point IndexedDB at it) after its local data
      // was wiped, or overwrite the session that replaced it.
      const current = getState().auth;
      if (isStaleSession(current, sessionUserId, sessionId)) {
        return rejectWithValue('stale');
      }
      indexedDBService.setUserId(response.user.id);
      // A profile write that committed while this request was in flight makes the
      // answer's account snapshot older than the store. Keep the store's profile and
      // let the rotated token through; with no local write, the answer is the one that
      // carries another tab's changes. Only the same account may keep its local
      // profile: sibling tabs share one refresh cookie, so this answer can belong to
      // an account that signed in elsewhere, and its token must never be paired with
      // the profile of the account this tab was showing.
      if (
        current.user &&
        current.user.id === response.user.id &&
        profileWriteCountFor(current.user.id, sessionId) !== writesAtStart
      ) {
        return { ...response, user: current.user };
      }
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

export type ProfileUpdate = { displayName: string } | { avatar: File } | { removeAvatar: true };

/** Thrown inside the write queue when the login that queued the write is gone. */
class SessionChangedError extends Error {}

interface ProfileMutationResult {
  user: AuthUser;
  /** The session that dispatched the mutation, so a later login cannot receive it. */
  sessionId: number;
}

/**
 * Each answer carries the whole account, so two writes in flight can answer out of
 * order and the older answer would restore the other field's previous value. One at a
 * time; the queue lives here so a closed dialog cannot leave a second write unqueued.
 */
let profileWriteQueue: Promise<unknown> = Promise.resolve();

function serializeProfileWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = profileWriteQueue.then(write);
  profileWriteQueue = result.catch(() => undefined);
  return result;
}

/**
 * Every profile mutation answers with the whole account, so the store, the session
 * snapshot and therefore the sidebar chip, comment avatars and member rows all move
 * together from one place.
 */
export const updateProfileThunk = createAsyncThunk<
  ProfileMutationResult,
  ProfileUpdate,
  { state: { auth: AuthState }; rejectValue: string }
>('auth/updateProfile', async (update, { getState, rejectWithValue }) => {
  const { accessToken, user, sessionId } = getState().auth;
  if (!accessToken || !user) {
    return rejectWithValue('You need to be signed in to change your profile.');
  }
  const userId = user.id;

  try {
    const updated = await serializeProfileWrite(() => {
      // A write can wait a while behind another one. Sending it with the token
      // captured before that wait would still change this browser's previous
      // account after a logout, and would present a token a rotation has
      // already replaced. The session guard in the reducer only discards the
      // answer; the request itself must not go out.
      const current = getState().auth;
      if (
        current.sessionId !== sessionId ||
        (current.user?.id ?? null) !== userId ||
        !current.accessToken
      ) {
        throw new SessionChangedError();
      }
      const token = current.accessToken;
      if ('displayName' in update) {
        return profileApiService.updateDisplayName(token, update.displayName);
      }
      if ('avatar' in update) {
        return profileApiService.uploadAvatar(token, update.avatar);
      }
      return profileApiService.removeAvatar(token);
    });
    recordProfileWrite(userId, sessionId);
    return { user: updated, sessionId };
  } catch (err) {
    if (err instanceof SessionChangedError) {
      return rejectWithValue('You need to be signed in to change your profile.');
    }
    // The API's message is the one worth showing: it says why a photo was refused.
    return rejectWithValue(
      err instanceof Error && err.message ? err.message : 'Could not update your profile.'
    );
  }
});

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
  reducers: {},
  extraReducers: (builder) => {
    builder
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

    builder.addCase(updateProfileThunk.fulfilled, (state, action) => {
      // A profile answer that lands after the session changed belongs to the account
      // and login that asked for it, not to the one looking at the dialog now — and a
      // signed-out store must stay signed out: the token is gone, so there is nobody to
      // show. The id alone is not enough: signing out and back in to the same account
      // is a different session.
      const { user, sessionId } = action.payload;
      if (
        !state.user ||
        !state.accessToken ||
        state.user.id !== user.id ||
        state.sessionId !== sessionId
      ) {
        return;
      }
      state.user = user;
    });

    builder.addCase(logoutThunk.fulfilled, (state) => {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.lastSilentRefreshAt = null;
      state.sessionId += 1;
    });
  },
});

export default authSlice.reducer;

// Session side effects live here, not in reducers: guest link mirrors must
// not leak into the signed-in session, and snapshots belong in storage.
export const authListenerMiddleware = createListenerMiddleware();
authListenerMiddleware.startListening({
  actionCreator: refreshSessionThunk.fulfilled,
  effect: async (_action, listenerApi) => {
    const previousUser = (listenerApi.getOriginalState() as { auth: AuthState }).auth.user;
    const nextUser = (listenerApi.getState() as { auth: AuthState }).auth.user;
    // A rotated token keeps the same identity and its per-identity cache keys;
    // only a refresh that boots (or switches) the account invalidates URLs.
    if ((previousUser?.id ?? null) !== (nextUser?.id ?? null)) {
      attachmentService.resetAttachmentUrlCache();
    }
    documentService.clearSessionRegistries();
    persistAuthSnapshot((listenerApi.getState() as { auth: AuthState }).auth);
  },
});
authListenerMiddleware.startListening({
  actionCreator: updateProfileThunk.fulfilled,
  // A rename or a new photo has to survive a reload, and the snapshot is the only
  // place that identity is kept between sessions.
  effect: async (_action, listenerApi) => {
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
