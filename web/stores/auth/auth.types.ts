export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** Expiry as Unix milliseconds */
  expiresAt: number | null;
  lastAuthAction: 'login' | 'register' | null;
  isLoading: boolean;
  isInitializing: boolean;
  error: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  displayName: string;
  password: string;
}

export interface AuthApiResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
}
