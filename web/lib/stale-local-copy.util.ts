import type * as Y from '@y/y';
import type { DocumentMeta } from '@/types/document.types';
import { decodeYjsState, encodeYjsState } from '@/lib/yjs.util';

/**
 * Where a local copy the merge refused to fold in is kept.
 *
 * `hasRelatedYjsHistory` can only tell that two Yjs histories are independent; it cannot
 * say whether that is a reseeded row or an offline copy that never saw the room. Folding
 * them together is not an option (the union is a second block tree BlockNote cannot
 * render), so the cloud copy wins — but the losing copy is written here first, because
 * this is the last moment its edits exist anywhere.
 *
 * Kept in `localStorage` beside the pending-edit markers rather than as a document row:
 * it must not appear in a listing or be picked up by the offline sync queue. Recovery
 * reads it with {@link readPreservedLocalCopy} and decodes the state back into a `Y.Doc`.
 */
const STALE_COPY_KEY_PREFIX = 'nextdocs:stale-local-copy:';

export interface PreservedLocalCopy {
  documentId: string;
  /** When the copy was set aside, ISO-8601. */
  savedAt: string;
  meta: DocumentMeta;
  /** Base64 of {@link encodeYjsState}, so a recovery can decode it with `decodeYjsState`. */
  yjsState: string;
}

function storageKey(documentId: string): string {
  return `${STALE_COPY_KEY_PREFIX}${documentId}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // `String.fromCharCode(...bytes)` blows the argument limit on large documents.
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Set the local copy aside before the cloud snapshot replaces it. Returns whether the
 * copy is now stored: a quota error or disabled storage means it is about to be lost, and
 * the caller reports that instead of claiming the work was kept.
 */
export function preserveStaleLocalCopy({
  documentId,
  ydoc,
  meta,
}: {
  documentId: string;
  ydoc: Y.Doc;
  meta: DocumentMeta;
}): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const record: PreservedLocalCopy = {
      documentId,
      savedAt: new Date().toISOString(),
      meta,
      yjsState: toBase64(encodeYjsState(ydoc)),
    };
    window.localStorage.setItem(storageKey(documentId), JSON.stringify(record));
    return true;
  } catch (error) {
    console.warn(`Could not set aside the local copy of ${documentId}:`, error);
    return false;
  }
}

/** The copy set aside for {@code documentId}, decoded, or null when there is none. */
export function readPreservedLocalCopy(
  documentId: string
): { savedAt: string; meta: DocumentMeta; ydoc: Y.Doc } | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(documentId));
    if (!raw) {
      return null;
    }
    const record = JSON.parse(raw) as PreservedLocalCopy | null;
    if (!record || typeof record.yjsState !== 'string' || !record.meta) {
      return null;
    }
    return {
      savedAt: record.savedAt,
      meta: record.meta,
      ydoc: decodeYjsState(fromBase64(record.yjsState)),
    };
  } catch (error) {
    console.warn(`Could not read the local copy set aside for ${documentId}:`, error);
    return null;
  }
}

/** Drop the copy set aside for {@code documentId}; returns whether one was stored. */
export function clearPreservedLocalCopy(documentId: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const key = storageKey(documentId);
    const existed = window.localStorage.getItem(key) !== null;
    window.localStorage.removeItem(key);
    return existed;
  } catch {
    return false;
  }
}
