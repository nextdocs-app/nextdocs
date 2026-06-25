import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { setThemeInStore } from '@/stores/theme/theme.slice';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const storedTheme = localStorage.getItem(STORAGE_KEY);
  return isTheme(storedTheme) ? storedTheme : 'system';
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);

  root.classList.toggle('dark', isDark);
  root.setAttribute('data-theme', theme);
}

export function useTheme() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.theme.theme);

  // Sync state with DOM on theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Initialize store from localStorage exactly once on mount
  useEffect(() => {
    const stored = getStoredTheme();
    dispatch(setThemeInStore(stored));
  }, [dispatch]);

  // Sync all useTheme instances within the same tab via a manually dispatched storage event
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const nextTheme = isTheme(e.newValue) ? e.newValue : 'system';
        dispatch(setThemeInStore(nextTheme));
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [dispatch]);

  // Respond to OS preference changes when in system mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const current = getStoredTheme();
      if (current === 'system') {
        applyTheme('system');
        dispatch(setThemeInStore('system'));
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [dispatch]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      dispatch(setThemeInStore(newTheme));
      localStorage.setItem(STORAGE_KEY, newTheme);
      // Dispatching on window notifies all other useTheme instances in this tab
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: newTheme }));
      applyTheme(newTheme);
    },
    [dispatch]
  );

  // Resolved to the actual applied theme — never 'system'
  const resolvedTheme: 'light' | 'dark' =
    typeof window !== 'undefined'
      ? theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
      : 'light';

  return { theme, setTheme, resolvedTheme };
}
