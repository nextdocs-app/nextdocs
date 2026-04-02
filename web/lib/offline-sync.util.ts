const PENDING_SYNC_KEY_PREFIX = 'nextdocs:pending-sync:';
export const PENDING_SYNC_EVENT = 'nextdocs-pending-sync-changed';

interface PendingSyncEventDetail {
  documentId: string;
  pendingEdits: number;
}

function getStorageKey(documentId: string): string {
  return `${PENDING_SYNC_KEY_PREFIX}${documentId}`;
}

function notifyPendingSyncChanged(documentId: string, pendingEdits: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PendingSyncEventDetail>(PENDING_SYNC_EVENT, {
      detail: {
        documentId,
        pendingEdits,
      },
    })
  );
}

export function readPendingSyncEdits(documentId: string): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const raw = window.localStorage.getItem(getStorageKey(documentId));
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

export function writePendingSyncEdits(documentId: string, pendingEdits: number): number {
  const normalized = Math.max(0, Math.floor(pendingEdits));

  if (typeof window !== 'undefined') {
    const storageKey = getStorageKey(documentId);
    if (normalized <= 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, String(normalized));
    }
  }

  notifyPendingSyncChanged(documentId, normalized);
  return normalized;
}

export function incrementPendingSyncEdits(documentId: string, delta = 1): number {
  const nextValue = readPendingSyncEdits(documentId) + Math.max(1, Math.floor(delta));
  return writePendingSyncEdits(documentId, nextValue);
}

export function clearPendingSyncEdits(documentId: string): void {
  writePendingSyncEdits(documentId, 0);
}
