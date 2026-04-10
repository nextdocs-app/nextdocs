import { DocumentServiceApiError } from '@/services/document.service';

export const CLOUD_BACKOFF_MS = 30_000;

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

export function isConnectivityError(error: unknown): boolean {
  if (error instanceof DocumentServiceApiError) {
    return error.status >= 500 || error.status === 0;
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
