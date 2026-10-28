import { getApiBaseUrl } from '@/lib/api-url.util';
import { parseApiEnvelope } from '@/services/api-envelope';

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions {
  /** Return `undefined` instead of throwing when the API answers 204 or omits `data`. */
  allowEmptyData?: boolean;
  /**
   * Include the raw response body in parse failures. Login is undebuggable
   * without the payload, so auth requests opt in; other callers stay terse.
   */
  includeRawBodyOnParseError?: boolean;
}

/**
 * JSON request against `/api/v1` with the uniform response envelope unwrapped.
 *
 * Always sends the refresh cookie (`credentials: 'include'`) and treats a
 * `success: false` envelope as an error even on HTTP 200.
 *
 * `Content-Type` is only sent when there is a body: a body-less GET declaring a
 * JSON payload is not a simple request, so it buys a CORS preflight for
 * nothing on every probe (e.g. the instance status the join page polls).
 */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<T> {
  // FormData carries its own multipart boundary. Declaring JSON would both
  // break the parse server-side and hide the boundary the browser must add.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body == null || isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });

  if (options.allowEmptyData && res.ok && res.status === 204) {
    return undefined as T;
  }

  const responseClone = options.includeRawBodyOnParseError ? res.clone() : null;
  const body = await parseApiEnvelope<T>(res, async (error: unknown) => {
    if (!responseClone) {
      throw error;
    }

    if (error instanceof SyntaxError || error instanceof TypeError) {
      const rawBody = await responseClone.text();
      const status = `${res.status} ${res.statusText}`.trim();
      throw new ApiError(
        `Failed to parse JSON response (${status}). Raw body: ${rawBody || '<empty>'}`,
        res.status
      );
    }

    throw error;
  });

  if (!res.ok || !body?.success) {
    throw new ApiError(body?.error ?? `Request failed with status ${res.status}`, res.status);
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
