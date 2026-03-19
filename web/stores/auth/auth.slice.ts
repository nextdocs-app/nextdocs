import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type {
  AuthState,
  LoginCredentials,
  RegisterCredentials,
  AuthApiResponse,
} from './auth.types';
import { authApiService, ApiError } from '@/services/auth.service';

const initialState: AuthState = {
  user: null,
  accessToken: null,
  expiresAt: null,
  isLoading: false,
  isInitializing: true,
  error: null,
};

export const loginThunk = createAsyncThunk<AuthApiResponse, LoginCredentials>(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      return await authApiService.login(credentials);
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
      return await authApiService.register(credentials);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed.';
      return rejectWithValue(message);
    }
  }
);

export const refreshSessionThunk = createAsyncThunk<AuthApiResponse>(
  'auth/refresh',
  async (_, { rejectWithValue }) => {
    try {
      return await authApiService.refresh();
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return rejectWithValue('unauthorized');
      }
      return rejectWithValue('failed');
    }
  }
);

export const logoutThunk = createAsyncThunk<void>('auth/logout', async () => {
  // Best-effort: revoke the server-side refresh token. Swallow errors so the
  // client-side state is always cleared regardless of API reachability.
  try {
    await authApiService.logout();
  } catch {
    // ignore
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuthFromResponse(state, action: PayloadAction<AuthApiResponse>) {
      const { user, accessToken, expiresIn } = action.payload;
      state.user = user;
      state.accessToken = accessToken;
      state.expiresAt = Date.now() + expiresIn * 1000;
      state.error = null;
    },
    clearAuth(state) {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
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
        if (state.isInitializing) {
          state.isInitializing = false;
        }
      })
      .addCase(refreshSessionThunk.rejected, (state, action) => {
        if (action.payload === 'unauthorized') {
          state.user = null;
          state.accessToken = null;
          state.expiresAt = null;
        }
        if (state.isInitializing) {
          state.isInitializing = false;
        }
      });

    builder.addCase(logoutThunk.fulfilled, (state) => {
      state.user = null;
      state.accessToken = null;
      state.expiresAt = null;
      state.error = null;
    });
  },
});

export const { setAuthFromResponse, clearAuth, clearError, setInitializing } = authSlice.actions;
export default authSlice.reducer;
