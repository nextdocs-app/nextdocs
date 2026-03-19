import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../../../hooks/useTheme.hook';

function stubMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(false);
  });

  it('defaults to "system" when localStorage has no stored preference', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });

  it('reads the stored theme from localStorage on initialization', () => {
    localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme updates the theme and persists it to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('dark');
    });
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('a StorageEvent for "theme" syncs the theme state across hook instances', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    });
    expect(result.current.theme).toBe('dark');
  });

  it('resolvedTheme follows OS preference when theme is "system"', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('resolvedTheme returns the explicit choice regardless of OS preference', () => {
    localStorage.setItem('theme', 'light');
    stubMatchMedia(true); // OS wants dark — explicit "light" must win
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('light');
  });
});
