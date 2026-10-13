import { renderHook, waitFor, act } from '@testing-library/react';
import { attachmentService } from '../../../services/attachment.service';
import { useResolvedAssetUrl } from '../../../hooks/useResolvedAssetUrl.hook';
import type { ResolvableAsset } from '../../../hooks/useResolvedAssetUrl.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';

jest.mock('../../../hooks/useNetworkStatus.hook', () => ({
  useNetworkStatus: jest.fn(() => ({ isOnline: true, isOffline: false })),
}));

const uploadAsset: ResolvableAsset = {
  type: 'upload',
  value: '12345678-1234-1234-1234-123456789012',
};

describe('useResolvedAssetUrl', () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true, isOffline: false });
    resolveSpy = jest.spyOn(attachmentService, 'resolveAttachmentUrl');
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  it('does not attempt a resolution while offline', async () => {
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: false, isOffline: true });
    resolveSpy.mockResolvedValue('https://signed.example/x');

    const { result } = renderHook(() => useResolvedAssetUrl(uploadAsset, 'token'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('retries an offline failure on reconnect', async () => {
    const networkState = { isOnline: false, isOffline: true };
    (useNetworkStatus as jest.Mock).mockImplementation(() => networkState);
    // No rejection queued: while offline the hook never attempts a resolution.
    resolveSpy.mockResolvedValue('https://signed.example/reconnected');

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { result, rerender } = renderHook(() => useResolvedAssetUrl(uploadAsset, 'token'));

      await act(async () => {
        await Promise.resolve();
      });

      // Offline: no attempt at all, so no failure to show.
      expect(resolveSpy).not.toHaveBeenCalled();

      networkState.isOnline = true;
      networkState.isOffline = false;
      rerender();

      await waitFor(() => {
        expect(result.current).toBe('https://signed.example/reconnected');
      });
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('returns link values directly without resolving', () => {
    resolveSpy.mockImplementation(jest.fn());

    const { result } = renderHook(() =>
      useResolvedAssetUrl({ type: 'link', value: 'https://cdn.example/x.jpg' }, null)
    );

    expect(result.current).toBe('https://cdn.example/x.jpg');
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
