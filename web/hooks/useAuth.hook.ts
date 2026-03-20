'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  loginThunk,
  registerThunk,
  logoutThunk,
  refreshSessionThunk,
} from '@/stores/auth/auth.slice';
import type { LoginCredentials, RegisterCredentials } from '@/stores/auth/auth.types';

/**
 * Primary auth hook. Exposes auth state and typed action helpers.
 *
 * Session initialisation (silent token refresh on app load) is performed once
 * inside AppShell, not here, to avoid firing the refresh API call for every
 * component that calls this hook.
 */
export function useAuth() {
  const dispatch = useAppDispatch();
  const { user, accessToken, expiresAt, isLoading, isInitializing, error } = useAppSelector(
    (state) => state.auth
  );

  /** Ticks every 10 s so time-dependent derived values stay reactive. */
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const login = useCallback(
    (credentials: LoginCredentials) => dispatch(loginThunk(credentials)),
    [dispatch]
  );

  const register = useCallback(
    (credentials: RegisterCredentials) => dispatch(registerThunk(credentials)),
    [dispatch]
  );

  const logout = useCallback(() => dispatch(logoutThunk()), [dispatch]);

  const refresh = useCallback(() => dispatch(refreshSessionThunk()), [dispatch]);

  const isAuthenticated = !!user && !!accessToken;

  /** True if the access token will expire within the next 60 seconds.
   *  Recomputed whenever `tick` advances (every 10 s) rather than once at render. */
  const isTokenExpiringSoon = isAuthenticated && expiresAt !== null && expiresAt - tick < 60_000;

  return {
    user,
    accessToken,
    isAuthenticated,
    isLoading,
    isInitializing,
    isTokenExpiringSoon,
    error,
    login,
    register,
    logout,
    refresh,
  };
}
