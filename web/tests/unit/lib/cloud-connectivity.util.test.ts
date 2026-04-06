import { isConnectivityError, isFetchNetworkError } from '@/lib/cloud-connectivity.util';
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
  });
});
