'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CLOUD_BACKOFF_MS } from '@/lib/cloud-connectivity.util';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';

export function useCloudBackoff() {
  const { isOnline } = useNetworkStatus();
  const backoffUntilRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasOnlineRef = useRef(isOnline);
  // The ref answers immediately (a caller can trigger and check in the same
  // tick); the state re-renders consumers when the timer expires so a queued
  // flush is retried instead of waiting for the next keystroke.
  const [backoffUntil, setBackoffUntil] = useState(0);

  const clearScheduledReset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  const clear = useCallback(() => {
    backoffUntilRef.current = 0;
    clearScheduledReset();
    setBackoffUntil(0);
  }, [clearScheduledReset]);

  const trigger = useCallback(
    (durationMs = CLOUD_BACKOFF_MS) => {
      const until = Date.now() + durationMs;
      backoffUntilRef.current = until;
      clearScheduledReset();
      setBackoffUntil(until);
      timeoutRef.current = setTimeout(() => {
        backoffUntilRef.current = 0;
        timeoutRef.current = undefined;
        setBackoffUntil(0);
      }, durationMs);
    },
    [clearScheduledReset]
  );

  const isInBackoff = useCallback(() => {
    if (!isOnline) {
      return true;
    }

    // The ref covers the tick between trigger() and its re-render.
    return Date.now() < Math.max(backoffUntil, backoffUntilRef.current);
  }, [isOnline, backoffUntil]);

  useEffect(() => {
    if (!wasOnlineRef.current && isOnline) {
      clear();
    }

    wasOnlineRef.current = isOnline;
  }, [isOnline, clear]);

  // Drop the timer without a state update: this cleanup runs on unmount.
  useEffect(
    () => () => {
      backoffUntilRef.current = 0;
      clearScheduledReset();
    },
    [clearScheduledReset]
  );

  return {
    trigger,
    clear,
    isInBackoff,
  };
}
