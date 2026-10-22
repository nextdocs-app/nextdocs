'use client';

import { useEffect } from 'react';
import { CLOUD_BACKOFF_MS } from '@/lib/cloud-connectivity.util';
import {
  discardPendingDocument,
  flushPendingCloudCreate,
  listPendingCloudCreates,
  PENDING_CLOUD_CREATE_EVENT,
  PENDING_CLOUD_CREATE_STORAGE_KEY_PREFIX,
} from '@/lib/pending-cloud-create.util';

/**
 * Reads connectivity through a function so TypeScript does not narrow the value
 * to `true` after the guard at the top of the flush.
 */
function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Replays cloud creations queued while offline (or while the API was
 * unreachable). Mounted once at the app shell so a document that is not open
 * still reaches the account.
 */
export function usePendingCloudDocumentCreates(
  userId: string | null,
  accessToken: string | null
): void {
  useEffect(() => {
    if (!userId || !accessToken) {
      return;
    }

    const uid = userId;
    const token = accessToken;

    let disposed = false;
    let flushing = false;
    let rerunRequested = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function clearRetry(): void {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    }

    async function flush(): Promise<void> {
      if (disposed || !isBrowserOnline()) {
        return;
      }
      if (flushing) {
        rerunRequested = true;
        return;
      }

      flushing = true;
      rerunRequested = false;
      clearRetry();

      const retriedIds = new Set<string>();

      try {
        // Bounded: a queue remove that cannot be persisted would otherwise
        // replay the same entry forever, hammering the create endpoint.
        let remaining = listPendingCloudCreates(uid).length;
        while (!disposed && remaining > 0) {
          remaining -= 1;

          if (!isBrowserOnline()) {
            break;
          }

          const entry = listPendingCloudCreates(uid).find(
            (candidate) => !retriedIds.has(candidate.id)
          );
          if (!entry) {
            break;
          }

          const result = await flushPendingCloudCreate(token, entry);
          if (result === 'retry') {
            // One document that must wait cannot block the rest of the queue.
            // Defer it to the next pass and keep going.
            retriedIds.add(entry.id);
            continue;
          }
          if (result === 'dropped') {
            await discardPendingDocument(entry.id, { announce: true });
          }
        }

        // Every deferred entry shares one timer instead of scheduling its own.
        if (!disposed && retriedIds.size > 0) {
          retryTimer = setTimeout(() => void flush(), CLOUD_BACKOFF_MS);
        }
      } finally {
        flushing = false;
        if (rerunRequested && !disposed && retryTimer === undefined) {
          rerunRequested = false;
          void flush();
        }
      }
    }

    // Another tab writes its own queue key; only a storage event tells this
    // tab that a document is waiting to be replayed.
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PENDING_CLOUD_CREATE_STORAGE_KEY_PREFIX)) {
        void flush();
      }
    };

    void flush();

    window.addEventListener('online', flush);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(PENDING_CLOUD_CREATE_EVENT, flush);

    return () => {
      disposed = true;
      clearRetry();
      window.removeEventListener('online', flush);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(PENDING_CLOUD_CREATE_EVENT, flush);
    };
  }, [userId, accessToken]);
}
