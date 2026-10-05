import { DocumentServiceApiError } from '@/services/document.service';

export const CLOUD_BACKOFF_MS = 30_000;
// Upper bound when honoring server Retry-After so a hostile header cannot park syncing.
const MAX_RETRY_AFTER_MS = 120_000;

export function retryAfterMs(error: unknown): number | null {
  if (error instanceof DocumentServiceApiError && error.retryAfterMs != null) {
    return Math.min(Math.max(error.retryAfterMs, 0), MAX_RETRY_AFTER_MS);
  }
  return null;
}

/** Backoff duration honoring server Retry-After (429) with a sane default. */
export function backoffMsFor(error: unknown): number {
  return retryAfterMs(error) ?? CLOUD_BACKOFF_MS;
}

export function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError) && !(error instanceof DOMException)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return (
    name === 'networkerror' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error')
  );
}

export function isRateLimitedError(error: unknown): boolean {
  return error instanceof DocumentServiceApiError && error.status === 429;
}

export function isConnectivityError(error: unknown): boolean {
  if (error instanceof DocumentServiceApiError) {
    // 429 is transient backpressure, not a verdict on access: back off and keep
    // stale UI instead of surfacing restricted/error states. The API answers
    // 429 with Retry-After; see RateLimitFilter.
    return error.status >= 500 || error.status === 0 || error.status === 429;
  }

  if (isFetchNetworkError(error)) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('failed to fetch') || message.includes('network');
  }

  return false;
}
