/** Wire types for the auth and onboarding endpoints. */

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
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
