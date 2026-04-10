'use client';

import { useCallback, useEffect, useRef } from 'react';
import { CLOUD_BACKOFF_MS } from '@/lib/cloud-connectivity.util';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';

export function useCloudBackoff() {
  const { isOnline } = useNetworkStatus();
  const backoffUntilRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasOnlineRef = useRef(isOnline);

  const clearScheduledReset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  const clear = useCallback(() => {
    backoffUntilRef.current = 0;
    clearScheduledReset();
  }, [clearScheduledReset]);

  const trigger = useCallback(
    (durationMs = CLOUD_BACKOFF_MS) => {
      backoffUntilRef.current = Date.now() + durationMs;
      clearScheduledReset();
      timeoutRef.current = setTimeout(() => {
        backoffUntilRef.current = 0;
        timeoutRef.current = undefined;
      }, durationMs);
    },
    [clearScheduledReset]
  );

  const isInBackoff = useCallback(() => {
    if (!isOnline) {
      return true;
    }

    return Date.now() < backoffUntilRef.current;
  }, [isOnline]);

  useEffect(() => {
    if (!wasOnlineRef.current && isOnline) {
      clear();
    }

    wasOnlineRef.current = isOnline;
  }, [isOnline, clear]);

  useEffect(() => clear, [clear]);

  return {
    trigger,
    clear,
    isInBackoff,
  };
}
