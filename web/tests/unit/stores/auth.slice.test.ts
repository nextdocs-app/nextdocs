import { configureStore } from '@reduxjs/toolkit';
import authReducer, {
  refreshSessionThunk,
  logoutThunk,
  updateProfileThunk,
  authListenerMiddleware,
  AUTH_SESSION_STORAGE_KEY,
} from '../../../stores/auth/auth.slice';
import { authApiService, ApiError } from '../../../services/auth.service';
import { profileApiService } from '../../../services/profile.service';
import { attachmentService } from '../../../services/attachment.service';
import type { AuthApiResponse, AuthUser } from '../../../types/auth.types';
import type { AuthState } from '../../../stores/auth/auth.types';

jest.mock('../../../services/auth.service', () => ({
  __esModule: true,
  ...jest.requireActual('../../../services/auth.service'),
  authApiService: {
    refresh: jest.fn(),
    logout: jest.fn(),
  },
}));

jest.mock('../../../services/profile.service', () => ({
  profileApiService: {
    updateDisplayName: jest.fn(),
    uploadAvatar: jest.fn(),
    removeAvatar: jest.fn(),
  },
}));

jest.mock('../../../lib/idb-isolation.util', () => ({
  clearLocalUserData: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/indexed-db.service', () => ({
  indexedDBService: {
    setUserId: jest.fn(),
  },
}));

jest.mock('../../../services/document.service', () => ({
  documentService: {
    clearSessionRegistries: jest.fn(),
  },
}));

import { clearLocalUserData } from '../../../lib/idb-isolation.util';
import { indexedDBService } from '../../../services/indexed-db.service';
import { documentService } from '../../../services/document.service';

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
};

const mockAuthResponse: AuthApiResponse = {
  accessToken: 'access-token-123',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: mockUser,
};

function makeStore(preloadedAuth?: Partial<AuthState>) {
  const preloadedState = preloadedAuth
    ? {
        auth: {
          user: null,
          accessToken: null,
          expiresAt: null,
          lastSilentRefreshAt: null,
          sessionId: 0,
          isInitializing: true,
          ...preloadedAuth,
        },
      }
    : undefined;
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(authListenerMiddleware.middleware),
  });
}

describe('auth slice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts with isInitializing=true and no user — prevents unauthenticated UI flash', () => {
    const { auth } = makeStore().getState();
    expect(auth.isInitializing).toBe(true);
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
  });

  it('refreshSessionThunk/pending leaves the throttle stamp untouched', async () => {
    let resolveRefresh!: (response: AuthApiResponse) => void;
    (authApiService.refresh as jest.Mock).mockImplementation(
      () =>
        new Promise<AuthApiResponse>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const store = makeStore();
    const pending = store.dispatch(refreshSessionThunk());
    // An in-flight attempt is not a completed one: the window opens on success.
    expect(store.getState().auth.lastSilentRefreshAt).toBeNull();

    resolveRefresh(mockAuthResponse);
    await pending;
  });

  it('refreshSessionThunk retries a generic failure instead of throttling it', async () => {
    (authApiService.refresh as jest.Mock)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockAuthResponse);
    const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

    const failed = await store.dispatch(refreshSessionThunk());
    expect(failed.meta.requestStatus).toBe('rejected');
    expect(store.getState().auth.lastSilentRefreshAt).toBeNull();

    const retried = await store.dispatch(refreshSessionThunk());
    expect(retried.meta.requestStatus).toBe('fulfilled');
    expect(authApiService.refresh).toHaveBeenCalledTimes(2);
    expect(store.getState().auth.lastSilentRefreshAt).not.toBeNull();
  });

  it('refreshSessionThunk retries once when a parallel tab rotated the cookie', async () => {
    // Two tabs can present the same refresh cookie; the loser sees 401 while
    // the shared jar already holds the replacement.
    (authApiService.refresh as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Refresh token is invalid', 401))
      .mockResolvedValueOnce(mockAuthResponse);
    const store = makeStore({ user: mockUser, accessToken: 'stale', isInitializing: false });

    const result = await store.dispatch(refreshSessionThunk());

    expect(refreshSessionThunk.fulfilled.match(result)).toBe(true);
    expect(authApiService.refresh).toHaveBeenCalledTimes(2);
    expect(store.getState().auth.user).toEqual(mockUser);
    expect(store.getState().auth.accessToken).toBe('access-token-123');
  });

  it('refreshSessionThunk does not retry a 401 when this tab never had a session', async () => {
    // A signed-out load is asking whether a session exists; a second identical
    // request cannot change that answer and doubles the unauthorized traffic.
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('No session', 401));
    const store = makeStore({ user: null, accessToken: null, isInitializing: true });

    const result = await store.dispatch(refreshSessionThunk());

    expect(refreshSessionThunk.rejected.match(result)).toBe(true);
    expect(authApiService.refresh).toHaveBeenCalledTimes(1);
    expect(store.getState().auth.user).toBeNull();
  });

  it('refreshSessionThunk still signs out when both refresh attempts are unauthorized', async () => {
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('No session', 401));
    const store = makeStore({ user: mockUser, accessToken: 'stale', isInitializing: false });

    const result = await store.dispatch(refreshSessionThunk());

    expect(refreshSessionThunk.rejected.match(result)).toBe(true);
    expect(authApiService.refresh).toHaveBeenCalledTimes(2);
    expect(store.getState().auth.user).toBeNull();
  });

  it('refreshSessionThunk/fulfilled marks initializing complete and restores session', async () => {
    (authApiService.refresh as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore({ isInitializing: true });
    await store.dispatch(refreshSessionThunk());
    const { auth } = store.getState();
    expect(auth.isInitializing).toBe(false);
    expect(auth.user).toEqual(mockUser);
    expect(auth.accessToken).toBe('access-token-123');
    expect(indexedDBService.setUserId).toHaveBeenCalledWith('user-1');
  });

  it('refreshSessionThunk/rejected clears state if unauthorized', async () => {
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('No session', 401));
    const store = makeStore({ user: mockUser, accessToken: 'stale', isInitializing: true });
    await store.dispatch(refreshSessionThunk());
    const { auth } = store.getState();
    expect(auth.isInitializing).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
    expect(indexedDBService.setUserId).toHaveBeenCalledWith(null);
  });

  it('refreshSessionThunk/rejected resets the coalescing state and drops the persisted session when unauthorized', async () => {
    window.sessionStorage.clear();
    window.localStorage.setItem(
      'nextdocs:pending-cloud-create:doc-offline',
      JSON.stringify({ id: 'doc-offline', userId: 'user-1', parentId: null })
    );
    window.sessionStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        user: mockUser,
        accessToken: 'stale',
        expiresAt: Date.now() + 1000 * 60,
      })
    );
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('Revoked', 403));
    const store = makeStore({
      user: mockUser,
      accessToken: 'stale',
      lastSilentRefreshAt: Date.now() - 60_000,
      isInitializing: false,
    });

    try {
      const result = await store.dispatch(refreshSessionThunk());
      const { auth } = store.getState();

      expect(refreshSessionThunk.rejected.match(result)).toBe(true);
      expect(auth.lastSilentRefreshAt).toBeNull();
      expect(auth.user).toBeNull();
      expect(auth.accessToken).toBeNull();
      expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
      // Expiry must not wipe local documents or the offline create queue.
      expect(clearLocalUserData).not.toHaveBeenCalled();
      expect(
        window.localStorage.getItem('nextdocs:pending-cloud-create:doc-offline')
      ).not.toBeNull();
      expect(indexedDBService.setUserId).toHaveBeenCalledWith(null);
    } finally {
      window.localStorage.clear();
    }
  });

  it('refreshSessionThunk/rejected retains state on network error and only changes isInitializing if true', async () => {
    (authApiService.refresh as jest.Mock).mockRejectedValue(new Error('Network error'));

    // Test when isInitializing is true
    const storeInit = makeStore({ user: mockUser, accessToken: 'stale', isInitializing: true });
    await storeInit.dispatch(refreshSessionThunk());
    expect(storeInit.getState().auth.isInitializing).toBe(false);

    // Test when it's a background refresh (isInitializing is already false)
    const storeBg = makeStore({ user: mockUser, accessToken: 'stale', isInitializing: false });
    await storeBg.dispatch(refreshSessionThunk());
    expect(storeBg.getState().auth.isInitializing).toBe(false);
    expect(storeBg.getState().auth.user).toEqual(mockUser);
  });

  it('logoutThunk always clears session — even when the server call fails', async () => {
    // The thunk intentionally swallows API errors so the local state is always cleared
    (authApiService.logout as jest.Mock).mockRejectedValue(new Error('network error'));
    const store = makeStore({ user: mockUser, accessToken: 'tok', expiresAt: 99999 });
    await store.dispatch(logoutThunk());
    const { auth } = store.getState();
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
    expect(auth.expiresAt).toBeNull();
    // Security: local user data must be wiped even when the API call fails.
    expect(clearLocalUserData).toHaveBeenCalledTimes(1);
    expect(indexedDBService.setUserId).toHaveBeenCalledWith(null);
  });

  it('forgets visited document pages on logout', async () => {
    const postMessage = jest.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: { postMessage } },
    });
    (authApiService.logout as jest.Mock).mockResolvedValue(undefined);

    try {
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });
      await store.dispatch(logoutThunk());

      expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_PRIVATE_PAGES' });
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  it('refreshSessionThunk/rejected clears cached attachment URLs when unauthorized', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('No session', 401));
    const store = makeStore({ user: mockUser, accessToken: 'stale' });

    await store.dispatch(refreshSessionThunk());

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('refreshSessionThunk/rejected with a non-401 error keeps the cache', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('Server error', 500));
    const store = makeStore({ user: mockUser, accessToken: 'stale' });

    const result = await store.dispatch(refreshSessionThunk());

    expect(refreshSessionThunk.rejected.match(result)).toBe(true);
    expect(resetSpy).not.toHaveBeenCalled();
    resetSpy.mockRestore();
  });

  it('refreshSessionThunk/fulfilled rotates the token without clearing the cache', async () => {
    // Token rotation is the same identity: per-identity cache keys keep the old
    // entries unreachable, so no invalidation (and no re-mint storm) is needed.
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.refresh as jest.Mock).mockResolvedValue({
      ...mockAuthResponse,
      accessToken: 'rotated-token',
    });
    const store = makeStore({ user: mockUser, accessToken: 'stale' });

    const result = await store.dispatch(refreshSessionThunk());

    expect(refreshSessionThunk.fulfilled.match(result)).toBe(true);
    expect(store.getState().auth.accessToken).toBe('rotated-token');
    expect(resetSpy).not.toHaveBeenCalled();
    resetSpy.mockRestore();
  });

  it('refreshSessionThunk/fulfilled clears the cache when the refresh boots a new identity', async () => {
    // A cold load starts with no user; the refresh cookie supplies one, so
    // links minted for the guest or a previous account must not survive.
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.refresh as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore();

    await store.dispatch(refreshSessionThunk());

    expect(store.getState().auth.user?.id).toBe('user-1');
    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('logoutThunk still clears the cache when the backend logout fails', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.logout as jest.Mock).mockRejectedValue(new Error('network down'));
    const store = makeStore({ user: mockUser, accessToken: 'tok', expiresAt: 99999 });

    await store.dispatch(logoutThunk());

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('a refresh never serves the previous session’s minted URL', async () => {
    const storedUrl = '/api/v1/attachments/11111111-2222-4333-8444-555555555555';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { url: `${storedUrl}/file?exp=4102444800&sig=aaa`, expiresAt: 4102444800 },
          error: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { url: `${storedUrl}/file?exp=4102444800&sig=bbb`, expiresAt: 4102444800 },
          error: null,
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    attachmentService.resetAttachmentUrlCache();
    (authApiService.refresh as jest.Mock).mockResolvedValue({
      ...mockAuthResponse,
      accessToken: 'token-b',
    });
    const store = makeStore();

    const first = await attachmentService.resolveAttachmentUrl(storedUrl, 'token-a');
    await store.dispatch(refreshSessionThunk());
    const second = await attachmentService.resolveAttachmentUrl(storedUrl, 'token-b');

    expect(first).toContain('sig=aaa');
    expect(second).toContain('sig=bbb');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('logoutThunk clears cached signed attachment URLs', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.logout as jest.Mock).mockResolvedValue(undefined);
    const store = makeStore({ user: mockUser, accessToken: 'tok', expiresAt: 99999 });

    await store.dispatch(logoutThunk());

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('logoutThunk sends current access token to backend logout endpoint', async () => {
    (authApiService.logout as jest.Mock).mockResolvedValue(undefined);
    const store = makeStore({ user: mockUser, accessToken: 'tok-logout', expiresAt: 99999 });

    await store.dispatch(logoutThunk());

    expect(authApiService.logout).toHaveBeenCalledWith('tok-logout');
    // Security: local user data must always be wiped on logout.
    expect(clearLocalUserData).toHaveBeenCalledTimes(1);
    expect(documentService.clearSessionRegistries).toHaveBeenCalledTimes(1);
  });

  it('refreshSessionThunk skips dispatch when lastSilentRefreshAt was within 30 seconds', async () => {
    (authApiService.refresh as jest.Mock).mockResolvedValue(mockAuthResponse);
    const stamp = Date.now() - 5000; // 5s ago (< 30s)
    const store = makeStore({
      user: mockUser,
      accessToken: 'tok',
      lastSilentRefreshAt: stamp,
    });

    const result = await store.dispatch(refreshSessionThunk());
    expect(result.meta.requestStatus).toBe('rejected');
    expect((result.meta as { condition?: boolean }).condition).toBe(true);
    expect(authApiService.refresh).not.toHaveBeenCalled();
    // A condition abort must not wipe the coalescing window.
    expect(store.getState().auth.lastSilentRefreshAt).toBe(stamp);
  });

  it('refreshSessionThunk shares one request between parallel dispatches', async () => {
    // An expired reload fires the mount refresh and the auto-refresh effect in
    // the same tick. Two rotations of one refresh cookie read as token reuse,
    // so the second dispatch must join the request already in flight.
    let resolveRefresh!: (response: AuthApiResponse) => void;
    (authApiService.refresh as jest.Mock).mockImplementation(
      () =>
        new Promise<AuthApiResponse>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

    const first = store.dispatch(refreshSessionThunk());
    const second = store.dispatch(refreshSessionThunk());

    expect(authApiService.refresh).toHaveBeenCalledTimes(1);

    resolveRefresh(mockAuthResponse);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    // Both callers get the token: aborting the waiter would surface the 401
    // that triggered it even though a fresh token just arrived.
    expect(refreshSessionThunk.fulfilled.match(firstResult)).toBe(true);
    expect(refreshSessionThunk.fulfilled.match(secondResult)).toBe(true);
    expect(authApiService.refresh).toHaveBeenCalledTimes(1);
  });

  it('starts a new refresh after logout instead of reusing the pre-logout rotation', async () => {
    let resolveFirst!: (response: AuthApiResponse) => void;
    let resolveSecond!: (response: AuthApiResponse) => void;
    (authApiService.refresh as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveSecond = resolve;
          })
      );
    const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

    const first = store.dispatch(refreshSessionThunk());
    await store.dispatch(logoutThunk());

    const second = store.dispatch(refreshSessionThunk());
    expect(authApiService.refresh).toHaveBeenCalledTimes(2);

    resolveSecond({ ...mockAuthResponse, accessToken: 'fresh-token' });
    expect(refreshSessionThunk.fulfilled.match(await second)).toBe(true);
    expect(store.getState().auth.accessToken).toBe('fresh-token');

    // The pre-logout rotation belongs to the previous session, even though the
    // account id is the same.
    resolveFirst(mockAuthResponse);
    expect(refreshSessionThunk.rejected.match(await first)).toBe(true);
    expect(store.getState().auth.accessToken).toBe('fresh-token');
  });

  it('does not let a failed refresh from a logged-out session sign out the next one', async () => {
    let rejectFirst!: (error: unknown) => void;
    let resolveSecond!: (response: AuthApiResponse) => void;
    (authApiService.refresh as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<AuthApiResponse>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveSecond = resolve;
          })
      );
    (authApiService.logout as jest.Mock).mockResolvedValue(undefined);
    const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

    const first = store.dispatch(refreshSessionThunk());
    await store.dispatch(logoutThunk());

    const second = store.dispatch(refreshSessionThunk());
    resolveSecond({ ...mockAuthResponse, accessToken: 'fresh-token' });
    await second;

    const { lastSilentRefreshAt: throttleStamp, sessionId: freshSessionId } = store.getState().auth;
    expect(throttleStamp).not.toBeNull();
    const setUserId = indexedDBService.setUserId as jest.Mock;
    const setUserIdCalls = setUserId.mock.calls.length;

    // Logout revoked the old refresh cookie, so the pre-logout rotation fails
    // after the new session has already refreshed successfully.
    rejectFirst(new ApiError('Revoked', 401));
    const result = await first;

    expect(refreshSessionThunk.rejected.match(result)).toBe(true);
    expect(result.payload).toBe('stale');
    const { auth } = store.getState();
    expect(auth.user?.id).toBe('user-1');
    expect(auth.accessToken).toBe('fresh-token');
    expect(auth.sessionId).toBe(freshSessionId);
    expect(auth.lastSilentRefreshAt).toBe(throttleStamp);
    expect(setUserId.mock.calls).toHaveLength(setUserIdCalls);
  });

  it('drops a refresh that resolves after logout', async () => {
    let resolveRefresh!: (response: AuthApiResponse) => void;
    (authApiService.refresh as jest.Mock).mockImplementation(
      () =>
        new Promise<AuthApiResponse>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    (authApiService.logout as jest.Mock).mockResolvedValue(undefined);
    const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

    const refresh = store.dispatch(refreshSessionThunk());
    await store.dispatch(logoutThunk());
    resolveRefresh(mockAuthResponse);
    const result = await refresh;

    expect(refreshSessionThunk.rejected.match(result)).toBe(true);
    expect(store.getState().auth.user).toBeNull();
    expect(store.getState().auth.accessToken).toBeNull();
    // The session snapshot must stay gone: re-persisting it would restore the
    // logged-out identity on the next reload.
    expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
    const setUserId = indexedDBService.setUserId as jest.Mock;
    expect(setUserId).not.toHaveBeenCalledWith('user-1');
  });

  it('refresh wipes session registries so guest mirrors do not leak', async () => {
    (authApiService.refresh as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore();

    await store.dispatch(refreshSessionThunk());

    expect(documentService.clearSessionRegistries).toHaveBeenCalledTimes(1);
  });

  describe('persistence', () => {
    beforeEach(() => {
      window.sessionStorage.clear();
      jest.clearAllMocks();
    });

    it('saves state to sessionStorage when a refresh restores the session', async () => {
      (authApiService.refresh as jest.Mock).mockResolvedValue(mockAuthResponse);
      const store = makeStore();

      await store.dispatch(refreshSessionThunk());

      const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const stored = JSON.parse(raw!);
      expect(stored.user).toEqual(mockUser);
      expect(stored.accessToken).toBe(mockAuthResponse.accessToken);
    });

    it('clears sessionStorage on logout', async () => {
      const snapshot = {
        user: mockUser,
        accessToken: 'stored-token',
        expiresAt: Date.now() + 1000 * 60,
      };
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
      (authApiService.logout as jest.Mock).mockResolvedValue(undefined);

      const store = makeStore({ user: mockUser, accessToken: 'stored-token' });
      await store.dispatch(logoutThunk());

      expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
    });

    it('initializes from sessionStorage if valid', async () => {
      const snapshot = {
        user: mockUser,
        accessToken: 'stored-token',
        expiresAt: Date.now() + 1000 * 60,
      };
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(snapshot));

      // We need to re-evaluate the module to check its top-level initialization code
      await jest.isolateModulesAsync(async () => {
        const authModule = await import('../../../stores/auth/auth.slice');
        const store = configureStore({ reducer: { auth: authModule.default } });
        const state = store.getState().auth;
        expect(state.user).toEqual(mockUser);
        expect(state.accessToken).toBe('stored-token');
      });
    });

    it('keeps an expired session identity so cached documents stay readable offline', async () => {
      const expiredSnapshot = {
        user: mockUser,
        accessToken: 'stale-token',
        expiresAt: Date.now() - 1000,
      };
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(expiredSnapshot));

      await jest.isolateModulesAsync(async () => {
        const authModule = await import('../../../stores/auth/auth.slice');
        const store = configureStore({ reducer: { auth: authModule.default } });
        // The refresh token may still be valid; a 401 on the next request is
        // what ends the session. Dropping it here would blank the sidebar for
        // an account whose access token expired while offline.
        expect(store.getState().auth.user?.id).toBe(mockUser.id);
        expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).not.toBeNull();
      });
    });
  });

  describe('updateProfileThunk', () => {
    it('refuses to call the API without a session', async () => {
      const store = makeStore({ user: null, accessToken: null, isInitializing: false });

      const result = await store.dispatch(updateProfileThunk({ displayName: 'Ada' }));

      expect(result.meta.requestStatus).toBe('rejected');
      expect(result.payload).toBe('You need to be signed in to change your profile.');
      expect(profileApiService.updateDisplayName).not.toHaveBeenCalled();
    });

    it('replaces the account and persists the new snapshot', async () => {
      const renamed = { ...mockUser, displayName: 'Ada Lovelace' };
      (profileApiService.updateDisplayName as jest.Mock).mockResolvedValue(renamed);
      window.sessionStorage.clear();
      const store = makeStore({
        user: mockUser,
        accessToken: 'tok',
        expiresAt: Date.now() + 60_000,
        isInitializing: false,
      });

      const result = await store.dispatch(updateProfileThunk({ displayName: 'Ada Lovelace' }));

      expect(result.meta.requestStatus).toBe('fulfilled');
      expect(profileApiService.updateDisplayName).toHaveBeenCalledWith('tok', 'Ada Lovelace');
      expect(store.getState().auth.user?.displayName).toBe('Ada Lovelace');
      // The sidebar chip and the next page load read the same store, and the
      // snapshot is what survives a reload.
      expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toContain('Ada Lovelace');
    });

    it('uploads a photo and removes it through the same thunk', async () => {
      const withPhoto = {
        ...mockUser,
        avatarUrl: '/api/v1/users/user-1/avatar?v=abc123',
      };
      (profileApiService.uploadAvatar as jest.Mock).mockResolvedValue(withPhoto);
      (profileApiService.removeAvatar as jest.Mock).mockResolvedValue({
        ...mockUser,
      });
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });
      const file = new File(['png'], 'a.png', { type: 'image/png' });

      await store.dispatch(updateProfileThunk({ avatar: file }));
      expect(profileApiService.uploadAvatar).toHaveBeenCalledWith('tok', file);
      expect(store.getState().auth.user?.avatarUrl).toBe(withPhoto.avatarUrl);

      await store.dispatch(updateProfileThunk({ removeAvatar: true }));
      expect(profileApiService.removeAvatar).toHaveBeenCalledWith('tok');
      expect(store.getState().auth.user?.avatarUrl).toBeNull();
    });

    it('surfaces the API message and keeps the current account', async () => {
      (profileApiService.uploadAvatar as jest.Mock).mockRejectedValue(
        new ApiError('Profile photos must be at most 2.0 MB.', 413)
      );
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const result = await store.dispatch(
        updateProfileThunk({ avatar: new File(['x'], 'a.png', { type: 'image/png' }) })
      );

      expect(result.meta.requestStatus).toBe('rejected');
      expect(result.payload).toBe('Profile photos must be at most 2.0 MB.');
      expect(store.getState().auth.user).toEqual(mockUser);
    });

    it('ignores an answer that belongs to an account the session already left', async () => {
      let resolveProfile!: (user: typeof mockUser) => void;
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveProfile = resolve;
          })
      );
      const other = { ...mockUser, id: 'user-2', displayName: 'Bob' };
      (authApiService.refresh as jest.Mock).mockResolvedValue({ ...mockAuthResponse, user: other });
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const pending = store.dispatch(updateProfileThunk({ displayName: 'Late Answer' }));
      // A different account takes over while the rename is in flight.
      await store.dispatch(refreshSessionThunk());
      resolveProfile({ ...mockUser, displayName: 'Late Answer' });
      await pending;

      expect(store.getState().auth.user?.displayName).toBe('Bob');
    });

    it('does not resurrect the account when signing out wins the race', async () => {
      let resolveProfile!: (user: typeof mockUser) => void;
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveProfile = resolve;
          })
      );
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const pending = store.dispatch(updateProfileThunk({ displayName: 'Late Answer' }));
      await store.dispatch(logoutThunk());
      resolveProfile({ ...mockUser, displayName: 'Late Answer' });
      await pending;

      const { user, accessToken } = store.getState().auth;
      expect(user).toBeNull();
      expect(accessToken).toBeNull();
    });

    it('does not start a second profile write until the first answers', async () => {
      let resolveName!: (user: typeof mockUser) => void;
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveName = resolve;
          })
      );
      const photoUrl = '/api/v1/users/user-1/avatar?v=new';
      (profileApiService.uploadAvatar as jest.Mock).mockResolvedValue({
        ...mockUser,
        displayName: 'Ada Lovelace',
        avatarUrl: photoUrl,
      });
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });
      const file = new File(['png'], 'a.png', { type: 'image/png' });

      const name = store.dispatch(updateProfileThunk({ displayName: 'Ada Lovelace' }));
      const photo = store.dispatch(updateProfileThunk({ avatar: file }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The name answer carries the account before the photo, so the photo must not
      // be sent until it has been applied.
      expect(profileApiService.uploadAvatar).not.toHaveBeenCalled();
      resolveName({ ...mockUser, displayName: 'Ada Lovelace' });
      await name;

      expect(profileApiService.uploadAvatar).toHaveBeenCalledWith('tok', file);
      await photo;

      const { user } = store.getState().auth;
      expect(user?.displayName).toBe('Ada Lovelace');
      expect(user?.avatarUrl).toBe(photoUrl);
    });

    it('ignores an answer from a session that signed out and back in', async () => {
      let resolveProfile!: (user: typeof mockUser) => void;
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveProfile = resolve;
          })
      );
      (authApiService.refresh as jest.Mock).mockResolvedValue({
        ...mockAuthResponse,
        user: { ...mockUser, displayName: 'Fresh Session' },
      });
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const pending = store.dispatch(updateProfileThunk({ displayName: 'Old Session' }));
      // Let the queued write start before the session changes under it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await store.dispatch(logoutThunk());
      await store.dispatch(refreshSessionThunk());
      resolveProfile({ ...mockUser, displayName: 'Old Session' });
      await pending;

      // The id matches, but this answer belongs to the login that just ended.
      expect(store.getState().auth.user?.displayName).toBe('Fresh Session');
    });

    it('keeps a rename when a second refresh joins one that predates it', async () => {
      let resolveRefresh!: (response: AuthApiResponse) => void;
      (authApiService.refresh as jest.Mock).mockImplementation(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveRefresh = resolve;
          })
      );
      (profileApiService.updateDisplayName as jest.Mock).mockResolvedValue({
        ...mockUser,
        displayName: 'Renamed',
      });
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const first = store.dispatch(refreshSessionThunk());
      await store.dispatch(updateProfileThunk({ displayName: 'Renamed' }));
      // Dispatched after the rename, but it joins the request that predates it,
      // so the shared answer is older than the store for both waiters.
      const second = store.dispatch(refreshSessionThunk());
      expect(authApiService.refresh).toHaveBeenCalledTimes(1);

      resolveRefresh({
        ...mockAuthResponse,
        accessToken: 'rotated',
        user: { ...mockUser, displayName: 'Stale Name' },
      });
      await Promise.all([first, second]);

      expect(store.getState().auth.accessToken).toBe('rotated');
      expect(store.getState().auth.user?.displayName).toBe('Renamed');
    });

    it('drops a queued write whose session ended while it waited', async () => {
      let resolveName!: (user: typeof mockUser) => void;
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveName = resolve;
          })
      );
      (authApiService.logout as jest.Mock).mockResolvedValue(undefined);
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const rename = store.dispatch(updateProfileThunk({ displayName: 'Ada' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const photo = store.dispatch(
        updateProfileThunk({ avatar: new File(['png'], 'a.png', { type: 'image/png' }) })
      );
      await store.dispatch(logoutThunk());

      resolveName({ ...mockUser, displayName: 'Ada' });
      const [, photoResult] = await Promise.all([rename, photo]);

      // The token captured before the wait stays usable until it expires, so the
      // request would still change the account that just signed out.
      expect(profileApiService.uploadAvatar).not.toHaveBeenCalled();
      expect(updateProfileThunk.rejected.match(photoResult)).toBe(true);
    });

    it('sends a queued write with the token a rotation put in place', async () => {
      let resolveName!: (user: typeof mockUser) => void;
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveName = resolve;
          })
      );
      (authApiService.refresh as jest.Mock).mockResolvedValue({
        ...mockAuthResponse,
        accessToken: 'rotated',
        user: mockUser,
      });
      (profileApiService.uploadAvatar as jest.Mock).mockResolvedValue({
        ...mockUser,
        avatarUrl: '/api/v1/users/user-1/avatar?v=new',
      });
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });
      const file = new File(['png'], 'a.png', { type: 'image/png' });

      const rename = store.dispatch(updateProfileThunk({ displayName: 'Ada' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const photo = store.dispatch(updateProfileThunk({ avatar: file }));
      await store.dispatch(refreshSessionThunk());
      resolveName({ ...mockUser, displayName: 'Ada' });
      await Promise.all([rename, photo]);

      expect(profileApiService.uploadAvatar).toHaveBeenCalledWith('rotated', file);
    });

    it('adopts a profile change committed by another tab', async () => {
      (authApiService.refresh as jest.Mock).mockResolvedValue({
        ...mockAuthResponse,
        user: { ...mockUser, displayName: 'Renamed Elsewhere' },
      });
      const store = makeStore({
        user: mockUser,
        accessToken: 'tok',
        isInitializing: false,
      });

      await store.dispatch(refreshSessionThunk());

      // No local write raced this refresh, so its snapshot is the newer one.
      expect(store.getState().auth.user?.displayName).toBe('Renamed Elsewhere');
    });

    it('lets a refresh rotate the token without rolling the profile back', async () => {
      let resolveRefresh!: (response: AuthApiResponse) => void;
      let resolveRename!: (user: typeof mockUser) => void;
      (authApiService.refresh as jest.Mock).mockImplementation(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveRefresh = resolve;
          })
      );
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRename = resolve;
          })
      );
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });

      const rename = store.dispatch(updateProfileThunk({ displayName: 'Renamed' }));
      const refresh = store.dispatch(refreshSessionThunk());
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The rename commits after the refresh started but before it answers.
      resolveRename({ ...mockUser, displayName: 'Renamed' });
      await rename;
      resolveRefresh({
        ...mockAuthResponse,
        accessToken: 'rotated',
        user: { ...mockUser, displayName: 'Stale Name' },
      });
      await refresh;

      expect(store.getState().auth.accessToken).toBe('rotated');
      expect(store.getState().auth.user?.displayName).toBe('Renamed');
    });

    it('never pairs another account’s token with this tab’s local profile', async () => {
      let resolveRefresh!: (response: AuthApiResponse) => void;
      let resolveRename!: (user: typeof mockUser) => void;
      (authApiService.refresh as jest.Mock).mockImplementation(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveRefresh = resolve;
          })
      );
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRename = resolve;
          })
      );
      const store = makeStore({ user: mockUser, accessToken: 'tok', isInitializing: false });
      const bob: AuthUser = {
        ...mockUser,
        id: 'user-2',
        email: 'bob@example.com',
        displayName: 'Bob',
      };

      const refresh = store.dispatch(refreshSessionThunk());
      const rename = store.dispatch(updateProfileThunk({ displayName: 'Renamed' }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The rename commits while the refresh is in flight, but the shared cookie
      // now belongs to Bob, who signed in from a sibling tab.
      resolveRename({ ...mockUser, displayName: 'Renamed' });
      await rename;
      resolveRefresh({ ...mockAuthResponse, accessToken: 'rotated', user: bob });
      await refresh;

      expect(store.getState().auth.accessToken).toBe('rotated');
      expect(store.getState().auth.user).toEqual(bob);
    });

    it('ignores a signed-out account’s write while the next account refreshes', async () => {
      let resolveRefresh!: (response: AuthApiResponse) => void;
      let resolveRename!: (user: typeof mockUser) => void;
      (authApiService.refresh as jest.Mock).mockImplementation(
        () =>
          new Promise<AuthApiResponse>((resolve) => {
            resolveRefresh = resolve;
          })
      );
      (profileApiService.updateDisplayName as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRename = resolve;
          })
      );
      const bob: AuthUser = {
        ...mockUser,
        id: 'user-2',
        email: 'bob@example.com',
        displayName: 'Bob',
      };
      const aliceStore = makeStore({
        user: mockUser,
        accessToken: 'tok',
        isInitializing: false,
      });
      const bobStore = makeStore({ user: bob, accessToken: 'bob-token', isInitializing: false });

      // Alice's write is still in flight when her session ends; it belongs to the
      // account that asked for it, not to the one the browser moved on to.
      const rename = aliceStore.dispatch(updateProfileThunk({ displayName: 'Renamed' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await aliceStore.dispatch(logoutThunk());
      const refresh = bobStore.dispatch(refreshSessionThunk());

      resolveRename({ ...mockUser, displayName: 'Renamed' });
      await rename;
      resolveRefresh({
        ...mockAuthResponse,
        accessToken: 'rotated',
        user: { ...bob, displayName: 'Renamed Elsewhere' },
      });
      await refresh;

      expect(bobStore.getState().auth.user?.displayName).toBe('Renamed Elsewhere');
    });
  });
});
