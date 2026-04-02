'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return emptySubscribe();
  }

  const handleChange = () => onStoreChange();
  window.addEventListener('online', handleChange);
  window.addEventListener('offline', handleChange);

  return () => {
    window.removeEventListener('online', handleChange);
    window.removeEventListener('offline', handleChange);
  };
}

function getSnapshot(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }

  return navigator.onLine;
}

export function useNetworkStatus() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, () => true);

  return {
    isOnline,
    isOffline: !isOnline,
  };
}
