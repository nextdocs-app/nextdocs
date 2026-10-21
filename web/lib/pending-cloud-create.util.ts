import { clearLocalDocumentParent } from '@/lib/local-tree.util';
import { clearPendingIconCoverPatch, clearPendingSyncEdits } from '@/lib/offline-sync.util';
import { DocumentServiceApiError, documentService } from '@/services/document.service';

// One key per entry: two tabs creating documents offline must not overwrite
// each other's queue with a whole-array read-modify-write.
const STORAGE_KEY_PREFIX = 'nextdocs:pending-cloud-create:';
export const PENDING_CLOUD_CREATE_STORAGE_KEY_PREFIX = STORAGE_KEY_PREFIX;
export const PENDING_CLOUD_CREATE_EVENT = 'nextdocs-pending-cloud-create-changed';
export const PENDING_DOCUMENT_DISCARDED_EVENT = 'nextdocs-pending-document-discarded';

// Only statuses that describe the request itself may delete a local document.
// Anything else (401, 408, 429, 5xx, unknown) stays queued for another attempt.
const PERMANENT_CREATE_FAILURE_STATUSES = new Set([400, 403, 404, 409, 410, 422]);

export interface PendingCloudCreate {
  id: string;
  userId: string;
  parentId: string | null;
  queuedAt: string;
}

function getStorageKey(id: string): string {
  return `${STORAGE_KEY_PREFIX}${id}`;
}

function parseEntry(raw: string | null): PendingCloudCreate | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const entry = parsed as PendingCloudCreate;
    if (
      typeof entry.id !== 'string' ||
      typeof entry.userId !== 'string' ||
      typeof entry.queuedAt !== 'string' ||
      (entry.parentId !== null && typeof entry.parentId !== 'string')
    ) {
      return null;
    }

    return entry;
  } catch {
    return null;
  }
}

function readAll(): PendingCloudCreate[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const entries: PendingCloudCreate[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) {
        continue;
      }

      const entry = parseEntry(window.localStorage.getItem(key));
      // Ignore a value stored under the wrong id: the key is the identity.
      if (entry && getStorageKey(entry.id) === key) {
        entries.push(entry);
      }
    }
    return entries;
  } catch {
    // An unreadable queue replays nothing rather than throwing during reconnect.
    return [];
  }
}

function notifyQueueChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDING_CLOUD_CREATE_EVENT));
  }
}

export function queuePendingCloudCreate(entry: Omit<PendingCloudCreate, 'queuedAt'>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      getStorageKey(entry.id),
      JSON.stringify({ ...entry, queuedAt: new Date().toISOString() })
    );
  } catch (error) {
    // Storage can be unavailable (quota, private mode). The document still
    // exists locally, so degradation beats failing the whole creation.
    console.warn('Failed to persist pending cloud creates:', error);
  }

  notifyQueueChanged();
}

/** Oldest first, so a child queued after its parent is created after it. */
export function listPendingCloudCreates(userId: string): PendingCloudCreate[] {
  return readAll()
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export function getPendingCloudCreate(
  id: string,
  userId?: string | null
): PendingCloudCreate | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const entry = parseEntry(window.localStorage.getItem(getStorageKey(id)));
  if (!entry) {
    return null;
  }

  // Queued work belongs to the account that created it: another session on the
  // same device must never push it into a different account.
  if (userId && entry.userId !== userId) {
    return null;
  }

  return entry;
}

export function removePendingCloudCreate(id: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (window.localStorage.getItem(getStorageKey(id)) === null) {
      return;
    }
    window.localStorage.removeItem(getStorageKey(id));
  } catch (error) {
    console.warn('Failed to remove a pending cloud create:', error);
    return;
  }

  notifyQueueChanged();
}

/**
 * Forgets a document that exists only on this device: queue entry, local copy,
 * parent link, and any offline edits waiting for a cloud row that will never
 * exist. Without this a rejected create leaves a ghost the sidebar can list
 * again after a degraded tree fetch.
 *
 * `announce` marks a discard the user did not ask for, so the UI can say why a
 * page they wrote disappeared.
 */
export async function discardPendingDocument(
  id: string,
  options?: { announce?: boolean }
): Promise<void> {
  removePendingCloudCreate(id);
  clearPendingSyncEdits(id);
  clearPendingIconCoverPatch(id);
  clearLocalDocumentParent(id);

  try {
    await documentService.deleteDocument(id);
  } catch (error) {
    console.warn('Failed to delete a discarded pending document:', error);
  }

  documentService.emitLocalDocumentsChanged();

  if (typeof window !== 'undefined') {
    const detail = { id, announce: options?.announce ?? false };
    window.dispatchEvent(new CustomEvent(PENDING_DOCUMENT_DISCARDED_EVENT, { detail }));
  }
}

/**
 * Creates the queued document in the cloud using its client-generated id.
 *
 * The create endpoint is idempotent (it returns the existing document), so a
 * replay after a lost response is safe.
 */
export async function flushPendingCloudCreate(
  accessToken: string,
  entry: PendingCloudCreate,
  ancestry: ReadonlySet<string> = new Set(),
  parentCleared = false
): Promise<'created' | 'retry' | 'dropped'> {
  // A child created offline can be replayed before its parent, which is also
  // still local-only. The server would reject that create (unknown parent) and
  // the queue would drop the child, so create ancestors first.
  const nextAncestry = new Set(ancestry);
  nextAncestry.add(entry.id);

  if (entry.parentId && !nextAncestry.has(entry.parentId)) {
    const pendingParent = getPendingCloudCreate(entry.parentId, entry.userId);
    if (pendingParent) {
      const parentResult = await flushPendingCloudCreate(accessToken, pendingParent, nextAncestry);
      if (parentResult !== 'created') {
        if (parentResult === 'dropped') {
          // The parent is gone, but refusing it says nothing about this child:
          // create the child at the root instead of deleting it too.
          await discardPendingDocument(pendingParent.id, { announce: true });
          return flushPendingCloudCreate(accessToken, { ...entry, parentId: null }, ancestry, true);
        }
        return parentResult;
      }
    }
  }

  let local: Awaited<ReturnType<typeof documentService.loadDocument>>;
  try {
    local = await documentService.loadDocument(entry.id);
  } catch (error) {
    // An unreadable local copy is not a permanent verdict; keep it queued so
    // a later retry can still promote the document.
    console.warn('Failed to read pending document locally:', error);
    return 'retry';
  }

  if (!local) {
    return 'dropped';
  }

  try {
    const created = await documentService.createCloudDocument(
      accessToken,
      entry.id,
      local.meta.title || 'Untitled',
      local.ydoc,
      local.meta.createdBy ?? null,
      entry.parentId
    );

    if (documentService.getCurrentUserId() !== entry.userId) {
      // The account switched while the create was in flight; caching these
      // bytes now would file them under the new account.
      return 'retry';
    }

    try {
      await documentService.saveDocument(entry.id, local.ydoc, created.meta, {
        touchUpdatedAt: false,
        origin: 'local',
      });
    } catch (cacheError) {
      // The cloud copy exists; a failed local mirror only costs a re-download.
      console.warn('Failed to cache created cloud document locally:', cacheError);
    }

    removePendingCloudCreate(entry.id);
    documentService.emitCloudDocumentsChanged();
    return 'created';
  } catch (error) {
    // A failed request is not a verdict on the document: only a permanent API
    // rejection may discard the local copy. Unknown failures stay queued so a
    // transient token, timeout, or connectivity problem can be replayed.
    if (
      !(error instanceof DocumentServiceApiError) ||
      !PERMANENT_CREATE_FAILURE_STATUSES.has(error.status)
    ) {
      return 'retry';
    }

    // The parent may have been deleted or become unwritable while the child
    // was local-only. Keep the document by retrying it at the root once.
    if (entry.parentId && !parentCleared && (error.status === 403 || error.status === 404)) {
      return flushPendingCloudCreate(accessToken, { ...entry, parentId: null }, ancestry, true);
    }

    console.warn('Dropping pending document creation:', error);
    return 'dropped';
  }
}
