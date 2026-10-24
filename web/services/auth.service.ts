import type { AuthApiResponse, LoginCredentials, RegisterCredentials } from '@/types/auth.types';
import { apiRequest } from '@/services/api-client';

export { ApiError } from '@/services/api-client';

function withBearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export const authApiService = {
  register(credentials: RegisterCredentials): Promise<AuthApiResponse> {
    return apiRequest<AuthApiResponse>(
      '/api/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(credentials),
      },
      { includeRawBodyOnParseError: true }
    );
  },

  login(credentials: LoginCredentials): Promise<AuthApiResponse> {
    return apiRequest<AuthApiResponse>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(credentials),
      },
      { includeRawBodyOnParseError: true }
    );
  },

  /** Uses the HTTP-only refresh token cookie — no token param needed. */
  refresh(): Promise<AuthApiResponse> {
    return apiRequest<AuthApiResponse>(
      '/api/v1/auth/refresh',
      { method: 'POST' },
      { includeRawBodyOnParseError: true }
    );
  },

  logout(accessToken?: string): Promise<void> {
    return apiRequest<void>(
      '/api/v1/auth/logout',
      {
        method: 'POST',
        headers: accessToken ? withBearer(accessToken) : {},
      },
      { allowEmptyData: true }
    );
  },
};
