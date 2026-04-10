import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';

describe('useNetworkStatus', () => {
  const originalNavigator = window.navigator;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock navigator.onLine
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, onLine: true },
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('initializes with current navigator.onLine status', () => {
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, onLine: false },
    });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
    expect(result.current.isOffline).toBe(true);
  });

  it('updates when the window "online" event is dispatched', () => {
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, onLine: false },
    });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);

    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, onLine: true },
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it('updates when the window "offline" event is dispatched', () => {
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, onLine: true },
    });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);

    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, onLine: false },
    });

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.isOffline).toBe(true);
  });
});
