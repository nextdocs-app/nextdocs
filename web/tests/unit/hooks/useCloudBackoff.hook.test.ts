import { act, renderHook } from '@testing-library/react';
import { CLOUD_BACKOFF_MS } from '@/lib/cloud-connectivity.util';
import { useCloudBackoff } from '@/hooks/useCloudBackoff.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';

jest.mock('../../../hooks/useNetworkStatus.hook', () => ({
  useNetworkStatus: jest.fn(() => ({
    isOnline: true,
    isOffline: false,
  })),
}));

describe('useCloudBackoff', () => {
  const networkState = {
    isOnline: true,
    isOffline: false,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    networkState.isOnline = true;
    networkState.isOffline = false;
    (useNetworkStatus as jest.Mock).mockImplementation(() => networkState);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('returns false initially', () => {
    const { result } = renderHook(() => useCloudBackoff());

    expect(result.current.isInBackoff()).toBe(false);
  });

  it('returns true after trigger', () => {
    const { result } = renderHook(() => useCloudBackoff());

    act(() => {
      result.current.trigger();
    });

    expect(result.current.isInBackoff()).toBe(true);
  });

  it('returns false after clear', () => {
    const { result } = renderHook(() => useCloudBackoff());

    act(() => {
      result.current.trigger();
      result.current.clear();
    });

    expect(result.current.isInBackoff()).toBe(false);
  });

  it('auto-expires after the timeout', () => {
    const { result } = renderHook(() => useCloudBackoff());

    act(() => {
      result.current.trigger();
    });

    expect(result.current.isInBackoff()).toBe(true);

    act(() => {
      jest.advanceTimersByTime(CLOUD_BACKOFF_MS - 1);
    });

    expect(result.current.isInBackoff()).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current.isInBackoff()).toBe(false);
  });

  it('clears backoff when the network recovers', () => {
    const { result, rerender } = renderHook(() => useCloudBackoff());

    act(() => {
      result.current.trigger();
    });

    networkState.isOnline = false;
    networkState.isOffline = true;
    rerender();
    expect(result.current.isInBackoff()).toBe(true);

    networkState.isOnline = true;
    networkState.isOffline = false;
    rerender();
    expect(result.current.isInBackoff()).toBe(false);
  });
});
