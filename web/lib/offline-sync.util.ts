import type { CoverRequestPayload, IconRequestPayload } from '@/lib/document-icon.util';

const PENDING_SYNC_KEY_PREFIX = 'nextdocs:pending-sync:';
const PENDING_ICON_COVER_KEY_PREFIX = 'nextdocs:pending-icon-cover:';
const PENDING_META_KEY_PREFIX = 'nextdocs:pending-meta:';
/**
 * Scope for work queued by an anonymous share-link session. Titles are queued per
 * account, so a later session on the same device cannot replay someone else's edit.
 */
export const PENDING_META_GUEST_OWNER = 'public';
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

/**
 * Writes the pending marker without notifying listeners.
 *
 * A save records the marker before its network call so a frozen tab or an
 * aborted upload still leaves a copy the next load will prefer. Publishing it
 * only once the write fails keeps the "pending sync" badge from flashing on
 * every successful keystroke.
 */
export function markPendingSyncEdits(documentId: string, pendingEdits: number): number {
  const normalized = Math.max(0, Math.floor(pendingEdits));

  if (typeof window !== 'undefined') {
    const storageKey = getStorageKey(documentId);
    if (normalized <= 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, String(normalized));
    }
  }

  return normalized;
}

export function writePendingSyncEdits(documentId: string, pendingEdits: number): number {
  const normalized = markPendingSyncEdits(documentId, pendingEdits);
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

/**
 * Drops the given keys' queued values once the server has them (or has definitively
 * refused them). A key queued again after the replay started is left in place, so a
 * newer edit stays eligible for REST submission. Without a patch the whole entry is
 * removed. Returns true when the entry is now empty and its marker can be acknowledged.
 */
export function clearPendingIconCoverPatch(
  documentId: string,
  patch?: PendingIconCoverPatch
): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const storageKey = getIconCoverStorageKey(documentId);
  if (patch === undefined) {
    const existed = window.localStorage.getItem(storageKey) !== null;
    window.localStorage.removeItem(storageKey);
    return existed;
  }

  const queued = readPendingIconCoverPatch(documentId);
  if (!queued) {
    return false;
  }
  if (patch.icon !== undefined && JSON.stringify(queued.icon) === JSON.stringify(patch.icon)) {
    delete queued.icon;
  }
  if (patch.cover !== undefined && JSON.stringify(queued.cover) === JSON.stringify(patch.cover)) {
    delete queued.cover;
  }
  if (queued.icon === undefined && queued.cover === undefined) {
    window.localStorage.removeItem(storageKey);
    return true;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(queued));
  return false;
}

/**
 * Metadata that only REST can persist, queued behind an offline or failed write.
 *
 * The title is mirrored into the Yjs meta map for instant cross-client sync, but
 * that copy is not durable: lists, trees and search read `documents.title`. Without
 * this queue a title typed offline survived until the next sync cleared the pending
 * marker and then reverted to the server's older value.
 */
export interface PendingMetaPatch {
  title?: string;
  /**
   * Epoch ms when this title was queued. A direct PATCH compares it with its own
   * start time so an older queued title cannot replay over a newer save, while a
   * title queued during the request still survives.
   */
  queuedAt?: number;
}

/** The account a queued metadata patch belongs to; guests use a fixed scope. */
export function pendingMetaOwner(userId: string | null | undefined): string {
  return userId ?? PENDING_META_GUEST_OWNER;
}

function getMetaStorageKey(owner: string, documentId: string): string {
  return `${PENDING_META_KEY_PREFIX}${owner}:${documentId}`;
}

function readPendingMetaEntry(owner: string, documentId: string): PendingMetaPatch | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(getMetaStorageKey(owner, documentId));
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const { title, queuedAt } = parsed as PendingMetaPatch;
  if (typeof title !== 'string') {
    return null;
  }
  return typeof queuedAt === 'number' && Number.isFinite(queuedAt)
    ? { title, queuedAt }
    : { title };
}

/** Queued metadata patch for `documentId`, or null when there is none. */
export function readPendingMetaPatch(owner: string, documentId: string): PendingMetaPatch | null {
  const entry = readPendingMetaEntry(owner, documentId);
  return entry ? { title: entry.title } : null;
}

/** When the queued title was written, or 0 for a pre-timestamp entry. */
export function readPendingMetaQueuedAt(owner: string, documentId: string): number {
  return readPendingMetaEntry(owner, documentId)?.queuedAt ?? 0;
}

/** Queues the title a replay has to PATCH; a newer edit replaces the earlier one. */
export function writePendingMetaPatch(
  owner: string,
  documentId: string,
  patch: PendingMetaPatch
): void {
  if (typeof window === 'undefined' || patch.title === undefined) {
    return;
  }

  window.localStorage.setItem(
    getMetaStorageKey(owner, documentId),
    JSON.stringify({ title: patch.title, queuedAt: patch.queuedAt ?? Date.now() })
  );
}

/**
 * Drops the queued title once the server has it (or has definitively refused it).
 * When `title` is given, a newer queued title is left alone: the replay carried the
 * older one, and the newer keystroke still has to reach the API.
 */
export function clearPendingMetaPatch(owner: string, documentId: string, title?: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (title !== undefined && readPendingMetaPatch(owner, documentId)?.title !== title) {
    return;
  }

  window.localStorage.removeItem(getMetaStorageKey(owner, documentId));
}

/**
 * Pending markers that belong to queued REST metadata rather than to content
 * handed to Yhub. A realtime sync acknowledges the content markers; these stay
 * until their PATCH lands.
 */
export function countPendingMetadataMarkers(owner: string, documentId: string): number {
  return (
    (readPendingMetaPatch(owner, documentId) ? 1 : 0) +
    (readPendingIconCoverPatch(documentId) ? 1 : 0)
  );
}

/** Drops markers the caller has just acknowledged, never going below zero. */
export function acknowledgePendingSyncEdits(documentId: string, count = 1): number {
  const pending = readPendingSyncEdits(documentId);
  if (pending <= 0) {
    return 0;
  }
  return writePendingSyncEdits(documentId, Math.max(0, pending - Math.max(1, count)));
}
