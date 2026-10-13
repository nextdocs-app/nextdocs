import type { CoverRequestPayload, IconRequestPayload } from '@/lib/document-icon.util';

const PENDING_SYNC_KEY_PREFIX = 'nextdocs:pending-sync:';
const PENDING_ICON_COVER_KEY_PREFIX = 'nextdocs:pending-icon-cover:';
export const PENDING_SYNC_EVENT = 'nextdocs-pending-sync-changed';

interface PendingSyncEventDetail {
  documentId: string;
  pendingEdits: number;
}

function getStorageKey(documentId: string): string {
  return `${PENDING_SYNC_KEY_PREFIX}${documentId}`;
}

function getIconCoverStorageKey(documentId: string): string {
  return `${PENDING_ICON_COVER_KEY_PREFIX}${documentId}`;
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

/**
 * Page icon/cover edits waiting to be replayed.
 *
 * Held beside the pending-edit counter rather than inside the queued meta
 * because a clear is information the local meta cannot carry: a cleared icon is
 * simply absent, and the content-save body omits that key — which the API reads
 * as "leave unchanged", never "clear" (see `DocumentIconRequest`). The replay
 * therefore has to send the same explicit `{ type: null }` payload the online
 * path PATCHes.
 *
 * Only the keys the reader actually changed are recorded, so an offline session
 * cannot push an unchanged local icon over a collaborator's newer one.
 */
export interface PendingIconCoverPatch {
  icon?: IconRequestPayload;
  cover?: CoverRequestPayload;
}

/** Queued icon/cover patch for {@code documentId}, or null when there is none. */
export function readPendingIconCoverPatch(documentId: string): PendingIconCoverPatch | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(getIconCoverStorageKey(documentId));
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unreadable queued state replays nothing rather than throwing mid-reconnect.
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const { icon, cover } = parsed as PendingIconCoverPatch;
  const patch: PendingIconCoverPatch = {};
  if (icon !== undefined) {
    patch.icon = icon;
  }
  if (cover !== undefined) {
    patch.cover = cover;
  }
  return patch.icon === undefined && patch.cover === undefined ? null : patch;
}

/**
 * Adds the keys present in {@code patch} to the queued patch, leaving the other
 * key alone so an icon edit and a later cover edit both survive one offline
 * session. A repeated write of the same key replaces the earlier one.
 */
export function mergePendingIconCoverPatch(documentId: string, patch: PendingIconCoverPatch): void {
  if (typeof window === 'undefined' || (patch.icon === undefined && patch.cover === undefined)) {
    return;
  }

  const merged: PendingIconCoverPatch = { ...(readPendingIconCoverPatch(documentId) ?? {}) };
  if (patch.icon !== undefined) {
    merged.icon = patch.icon;
  }
  if (patch.cover !== undefined) {
    merged.cover = patch.cover;
  }
  window.localStorage.setItem(getIconCoverStorageKey(documentId), JSON.stringify(merged));
}

/** Drops the queued patch once the server has it (or has definitively refused it). */
export function clearPendingIconCoverPatch(documentId: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(getIconCoverStorageKey(documentId));
  }
}
