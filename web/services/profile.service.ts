import { apiRequest } from '@/services/api-client';
import type { AuthUser } from '@/types/auth.types';

const PROFILE_PATH = '/api/v1/users/me';
const AVATAR_PATH = `${PROFILE_PATH}/avatar`;

function withBearer(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * The signed-in account's own profile. Separate from `authApiService`, which is only about
 * proving identity: every call here answers with the same `AuthUser` shape that
 * registration and login return, so the store never has to guess.
 */
export const profileApiService = {
  get(accessToken: string): Promise<AuthUser> {
    return apiRequest<AuthUser>(PROFILE_PATH, {
      method: 'GET',
      headers: withBearer(accessToken),
    });
  },

  /** Renames the account. Every list that shows a person joins this row, so nothing else moves. */
  updateDisplayName(accessToken: string, displayName: string): Promise<AuthUser> {
    return apiRequest<AuthUser>(PROFILE_PATH, {
      method: 'PATCH',
      headers: { ...withBearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  },

  /** Uploads a profile photo. The API sniffs the bytes, so the type must be a real raster image. */
  uploadAvatar(accessToken: string, file: File): Promise<AuthUser> {
    const body = new FormData();
    body.append('file', file);

    return apiRequest<AuthUser>(AVATAR_PATH, {
      method: 'PUT',
      headers: withBearer(accessToken),
      body,
    });
  },

  /** Drops the uploaded photo, so the account falls back to generated initials. */
  removeAvatar(accessToken: string): Promise<AuthUser> {
    return apiRequest<AuthUser>(AVATAR_PATH, {
      method: 'DELETE',
      headers: withBearer(accessToken),
    });
  },
};
