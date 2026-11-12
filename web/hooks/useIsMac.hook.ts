import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

function getIsMacSnapshot(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
}

/** SSR-safe platform check used to label keyboard shortcuts (⌘ vs Ctrl). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, getIsMacSnapshot, () => true);
}
