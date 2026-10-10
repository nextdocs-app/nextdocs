/**
 * Uniform envelope every `/api/v1` endpoint returns. Callers unwrap `data` (null on
 * errors) and surface `message`/`error` when `success` is false.
 */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  message?: string | null;
  timestamp?: string | null;
}

/**
 * Parses the envelope body without judging it: a non-JSON or empty body yields `null`
 * and the caller decides the error. `onError` lets callers with richer diagnostics
 * (auth keeps the raw body for login debugging) inspect the failure first.
 */
export async function parseApiEnvelope<T>(
  response: Response,
  onError?: (error: unknown) => Promise<never> | never
): Promise<ApiEnvelope<T> | null> {
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch (error: unknown) {
    if (onError) {
      await onError(error);
    }
    return null;
  }
}
