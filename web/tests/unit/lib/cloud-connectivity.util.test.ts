import {
  backoffMsFor,
  CLOUD_BACKOFF_MS,
  isConnectivityError,
  isFetchNetworkError,
  retryAfterMs,
} from '@/lib/cloud-connectivity.util';
import { DocumentServiceApiError } from '@/services/document.service';

describe('cloud-connectivity.util', () => {
  describe('isFetchNetworkError', () => {
    it('returns true for failed fetch TypeError', () => {
      expect(isFetchNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    });

    it('returns false for unrelated TypeError values', () => {
      expect(isFetchNetworkError(new TypeError('Cannot read properties of null'))).toBe(false);
    });

    it('returns true for DOMException network errors', () => {
      expect(isFetchNetworkError(new DOMException('Network request failed', 'NetworkError'))).toBe(
        true
      );
    });
  });

  describe('isConnectivityError', () => {
    it('returns true for 5xx API errors', () => {
      expect(isConnectivityError(new DocumentServiceApiError('Server error', 503))).toBe(true);
    });

    it('returns true for status 0 API errors', () => {
      expect(isConnectivityError(new DocumentServiceApiError('Network error', 0))).toBe(true);
    });

    it('returns false for non-connectivity API errors', () => {
      expect(isConnectivityError(new DocumentServiceApiError('Forbidden', 403))).toBe(false);
      expect(isConnectivityError(new DocumentServiceApiError('Not found', 404))).toBe(false);
    });

    it('returns true for generic network-flavored errors', () => {
      expect(isConnectivityError(new Error('Network request failed'))).toBe(true);
    });

    it('returns false for non-error values', () => {
      expect(isConnectivityError('failed to fetch')).toBe(false);
      expect(isConnectivityError(null)).toBe(false);
    });

    it('returns true for 429 rate limiting (transient backpressure)', () => {
      expect(isConnectivityError(new DocumentServiceApiError('Too many requests', 429))).toBe(true);
    });
  });

  describe('retryAfterMs / backoffMsFor', () => {
    it('parses Retry-After seconds from the error', () => {
      expect(retryAfterMs(new DocumentServiceApiError('Too many', 429, 60_000))).toBe(60_000);
    });

    it('returns null without Retry-After info', () => {
      expect(retryAfterMs(new DocumentServiceApiError('Too many', 429))).toBeNull();
      expect(retryAfterMs(new Error('nope'))).toBeNull();
    });

    it('caps hostile Retry-After values and defaults otherwise', () => {
      expect(backoffMsFor(new DocumentServiceApiError('Too many', 429, 9_000_000))).toBe(120_000);
      expect(backoffMsFor(new DocumentServiceApiError('Too many', 429, 5_000))).toBe(5_000);
      expect(backoffMsFor(new DocumentServiceApiError('Server error', 503))).toBe(CLOUD_BACKOFF_MS);
    });

    it('floors zero and negative Retry-After values at one second', () => {
      expect(retryAfterMs(new DocumentServiceApiError('Too many', 429, 0))).toBe(1_000);
      expect(retryAfterMs(new DocumentServiceApiError('Too many', 429, -5_000))).toBe(1_000);
    });
  });
});
