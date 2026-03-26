import { configureStore } from '@reduxjs/toolkit';
import authReducer, {
  loginThunk,
  registerThunk,
  refreshSessionThunk,
  logoutThunk,
  clearAuth,
  setAuthFromResponse,
} from '../../../stores/auth/auth.slice';
import { authApiService, ApiError } from '../../../services/auth.service';
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
          isLoading: false,
          isInitializing: true,
          error: null,
          ...preloadedAuth,
        },
      }
    : undefined;
  return configureStore({ reducer: { auth: authReducer }, preloadedState });
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
  });

  it('registerThunk/rejected records the error message', async () => {
    (authApiService.register as jest.Mock).mockRejectedValue(new Error('Email already exists'));
    const store = makeStore();
    await store.dispatch(registerThunk({ email: 'a@b.com', displayName: 'Alice', password: 'pw' }));
    expect(store.getState().auth.error).toBe('Email already exists');
  });

  it('refreshSessionThunk/pending has no handler — isLoading stays false during session restore', () => {
    (authApiService.refresh as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const store = makeStore();
    store.dispatch(refreshSessionThunk());
    expect(store.getState().auth.isLoading).toBe(false);
  });

  it('refreshSessionThunk/fulfilled marks initializing complete and restores session', async () => {
    (authApiService.refresh as jest.Mock).mockResolvedValue(mockAuthResponse);
    const store = makeStore({ isInitializing: true });
    await store.dispatch(refreshSessionThunk());
    const { auth } = store.getState();
    expect(auth.isInitializing).toBe(false);
    expect(auth.user).toEqual(mockUser);
    expect(auth.accessToken).toBe('access-token-123');
  });

  it('refreshSessionThunk/rejected clears state if unauthorized', async () => {
    (authApiService.refresh as jest.Mock).mockRejectedValue(new ApiError('No session', 401));
    const store = makeStore({ user: mockUser, accessToken: 'stale', isInitializing: true });
    await store.dispatch(refreshSessionThunk());
    const { auth } = store.getState();
    expect(auth.isInitializing).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
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
  });

  it('logoutThunk sends current access token to backend logout endpoint', async () => {
    (authApiService.logout as jest.Mock).mockResolvedValue(undefined);
    const store = makeStore({ user: mockUser, accessToken: 'tok-logout', expiresAt: 99999 });

    await store.dispatch(logoutThunk());

    expect(authApiService.logout).toHaveBeenCalledWith('tok-logout');
  });
});
