import type {
  AuthApiResponse,
  LoginCredentials,
  RegisterCredentials,
} from '@/stores/auth/auth.types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  message: string | null;
}

interface RequestOptions {
  allowEmptyData?: boolean;
}

async function request<T>(
  path: string,
  init: RequestInit,
  options: RequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include', // required to send/receive the HTTP-only refresh token cookie
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (options.allowEmptyData && res.ok && res.status === 204) {
    return undefined as T;
  }

  const responseClone = res.clone();
  let body: ApiEnvelope<T>;

  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      const rawBody = await responseClone.text();
      const status = `${res.status} ${res.statusText}`.trim();
      throw new ApiError(
        `Failed to parse JSON response (${status}). Raw body: ${rawBody || '<empty>'}`,
        res.status
      );
    }

    throw error;
  }

  if (!res.ok || !body.success) {
    throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
  }

  const data = body.data;
  if (data === null || data === undefined) {
    if (options.allowEmptyData) {
      return undefined as T;
    }

    throw new ApiError(
      `Request succeeded but response data was empty (${res.status} ${res.statusText}) for ${path}`,
      res.status
    );
  }

  return data as T;
}

function withBearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export const authApiService = {
  register(credentials: RegisterCredentials): Promise<AuthApiResponse> {
    return request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  login(credentials: LoginCredentials): Promise<AuthApiResponse> {
    return request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  /** Uses the HTTP-only refresh token cookie — no token param needed. */
  refresh(): Promise<AuthApiResponse> {
    return request('/api/v1/auth/refresh', { method: 'POST' });
  },

  logout(accessToken?: string): Promise<void> {
    return request(
      '/api/v1/auth/logout',
      {
        method: 'POST',
        headers: accessToken ? withBearer(accessToken) : {},
      },
      { allowEmptyData: true }
    );
  },

  getMe(accessToken: string): Promise<AuthApiResponse['user']> {
    return request('/api/v1/auth/me', {
      method: 'GET',
      headers: withBearer(accessToken),
    });
  },
};
