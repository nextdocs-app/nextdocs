import { configureStore } from '@reduxjs/toolkit';
import authReducer, {
  loginThunk,
  registerThunk,
  refreshSessionThunk,
  logoutThunk,
  clearAuth,
  setAuthFromResponse,
  authListenerMiddleware,
  AUTH_SESSION_STORAGE_KEY,
} from '../../../stores/auth/auth.slice';
import { authApiService, ApiError } from '../../../services/auth.service';
import { attachmentService } from '../../../services/attachment.service';
import type { AuthApiResponse, AuthState } from '../../../stores/auth/auth.types';

jest.mock('../../../services/auth.service', () => ({
  __esModule: true,
  ...jest.requireActual('../../../services/auth.service'),
  authApiService: {
    login: jest.fn(),
    register: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    getMe: jest.fn(),
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

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
  emailVerified: false,
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
          lastAuthAction: null,
          lastSilentRefreshAt: null,
          isLoading: false,
          isInitializing: true,
          error: null,
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
    expect(auth.isLoading).toBe(false);
  });

  it('setAuthFromResponse computes expiresAt as now + expiresIn seconds', () => {
    const before = Date.now();
    const store = makeStore();
    store.dispatch(setAuthFromResponse(mockAuthResponse));
    const after = Date.now();
    const { auth } = store.getState();
    expect(auth.user).toEqual(mockUser);
    expect(auth.accessToken).toBe('access-token-123');
    expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(auth.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it('clearAuth wipes user, token, and error', () => {
    const store = makeStore({
      user: mockUser,
      accessToken: 'tok',
      expiresAt: 999999,
      error: 'stale',
    });
    store.dispatch(clearAuth());
    const { auth } = store.getState();
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
    expect(auth.expiresAt).toBeNull();
    expect(auth.error).toBeNull();
  });

  it('loginThunk/pending sets isLoading=true and clears any prior error', () => {
    (authApiService.login as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const store = makeStore({ error: 'previous error' });
    store.dispatch(loginThunk({ email: 'a@b.com', password: 'pw' }));
    expect(store.getState().auth.isLoading).toBe(true);
    expect(store.getState().auth.error).toBeNull();
  });

  it('loginThunk/fulfilled populates user and access token', async () => {
    (authApiService.login as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore();
    await store.dispatch(loginThunk({ email: 'a@b.com', password: 'pw' }));
    const { auth } = store.getState();
    expect(auth.isLoading).toBe(false);
    expect(auth.user).toEqual(mockUser);
    expect(auth.accessToken).toBe('access-token-123');
    expect(auth.error).toBeNull();
    expect(indexedDBService.setUserId).toHaveBeenCalledWith('user-1');
  });

  it('loginThunk/rejected records the error message', async () => {
    (authApiService.login as jest.Mock).mockRejectedValue(new Error('Invalid credentials'));
    const store = makeStore();
    await store.dispatch(loginThunk({ email: 'a@b.com', password: 'wrong' }));
    const { auth } = store.getState();
    expect(auth.isLoading).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.error).toBe('Invalid credentials');
  });

  it('registerThunk/fulfilled populates user and access token', async () => {
    (authApiService.register as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore();
    await store.dispatch(registerThunk({ email: 'a@b.com', displayName: 'Alice', password: 'pw' }));
    const { auth } = store.getState();
    expect(auth.user).toEqual(mockUser);
    expect(auth.error).toBeNull();
    expect(indexedDBService.setUserId).toHaveBeenCalledWith('user-1');
  });

  it('registerThunk/rejected records the error message', async () => {
    (authApiService.register as jest.Mock).mockRejectedValue(new Error('Email already exists'));
    const store = makeStore();
    await store.dispatch(registerThunk({ email: 'a@b.com', displayName: 'Alice', password: 'pw' }));
    expect(store.getState().auth.error).toBe('Email already exists');
  });

  it('refreshSessionThunk/pending leaves isLoading false and defers the throttle stamp', () => {
    (authApiService.refresh as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const store = makeStore();
    store.dispatch(refreshSessionThunk());
    expect(store.getState().auth.isLoading).toBe(false);
    // An in-flight attempt is not a completed one: the window opens on success.
    expect(store.getState().auth.lastSilentRefreshAt).toBeNull();
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

  it('loginThunk/fulfilled clears signed attachment URLs cached by a previous session', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.login as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore();

    await store.dispatch(loginThunk({ email: 'a@b.com', password: 'pw' }));

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('registerThunk/fulfilled clears cached signed attachment URLs', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.register as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore();

    await store.dispatch(registerThunk({ email: 'a@b.com', displayName: 'Alice', password: 'pw' }));

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('setAuthFromResponse clears cached signed attachment URLs for the new identity', () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    const store = makeStore();

    store.dispatch(setAuthFromResponse(mockAuthResponse));

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
  });

  it('clearAuth clears cached signed attachment URLs', () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    const store = makeStore({ user: mockUser, accessToken: 'tok', expiresAt: 99999 });

    store.dispatch(clearAuth());

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resetSpy.mockRestore();
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

  it('loginThunk/rejected does not clear the cache', async () => {
    const resetSpy = jest.spyOn(attachmentService, 'resetAttachmentUrlCache');
    (authApiService.login as jest.Mock).mockRejectedValue(new ApiError('Bad credentials', 401));
    const store = makeStore();

    await store.dispatch(loginThunk({ email: 'a@b.com', password: 'wrong' }));

    expect(resetSpy).not.toHaveBeenCalled();
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

  it('a login never serves the previous session’s minted URL', async () => {
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
    (authApiService.login as jest.Mock).mockResolvedValue({
      ...mockAuthResponse,
      accessToken: 'token-b',
    });
    const store = makeStore();

    const first = await attachmentService.resolveAttachmentUrl(storedUrl, 'token-a');
    await store.dispatch(loginThunk({ email: 'a@b.com', password: 'pw' }));
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

  it('clearAuth wipes session registries', () => {
    const store = makeStore({ user: mockUser, accessToken: 'tok' });
    store.dispatch(clearAuth());
    expect(documentService.clearSessionRegistries).toHaveBeenCalled();
  });

  it('setAuthFromResponse wipes guest session registries on login', () => {
    const store = makeStore();
    store.dispatch(setAuthFromResponse(mockAuthResponse));
    expect(documentService.clearSessionRegistries).toHaveBeenCalledTimes(1);
  });

  describe('persistence', () => {
    beforeEach(() => {
      window.sessionStorage.clear();
      jest.clearAllMocks();
    });

    it('saves state to sessionStorage on setAuthFromResponse', () => {
      const store = makeStore();
      store.dispatch(setAuthFromResponse(mockAuthResponse));

      const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const stored = JSON.parse(raw!);
      expect(stored.user).toEqual(mockUser);
      expect(stored.accessToken).toBe(mockAuthResponse.accessToken);
    });

    it('clears sessionStorage on clearAuth', () => {
      const snapshot = {
        user: mockUser,
        accessToken: 'stored-token',
        expiresAt: Date.now() + 1000 * 60,
      };
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(snapshot));

      const store = makeStore();
      store.dispatch(clearAuth());

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

    it('removes expired session on initialization', async () => {
      const expiredSnapshot = {
        user: mockUser,
        accessToken: 'stale-token',
        expiresAt: Date.now() - 1000,
      };
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(expiredSnapshot));

      await jest.isolateModulesAsync(async () => {
        const authModule = await import('../../../stores/auth/auth.slice');
        const store = configureStore({ reducer: { auth: authModule.default } });
        expect(store.getState().auth.user).toBeNull();
        expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
      });
    });
  });
});
