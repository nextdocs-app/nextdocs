import type { AuthUser } from '@/types/auth.types';

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** Expiry as Unix milliseconds */
  expiresAt: number | null;
  /** Unix timestamp (ms) of the most recent silent refresh attempt, used to coalesce parallel dispatches. */
  lastSilentRefreshAt?: number | null;
  /** Bumped when the identity changes, so an in-flight refresh cannot revive a previous session. */
  sessionId: number;
  isLoading: boolean;
  isInitializing: boolean;
  error: string | null;
}
