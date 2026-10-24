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
  /** Present for invite sign-ups; omitted only by the first-account bootstrap. */
  inviteToken?: string;
}

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface InvitePreview {
  email: string;
  workspaceName: string;
  role: WorkspaceRole;
  expiresAt: string;
}

export interface AuthApiResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
}
