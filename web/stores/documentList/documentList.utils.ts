import { documentService } from '@/services/document.service';
import { toSortableTimestamp } from '@/lib/timestamp.util';
import type { DocumentMeta } from '@/types/document.types';
import type { LocalDocumentEntry, SharedDocumentEntry } from './documentList.types';

export const INITIAL_DOCS_COUNT = 7;
export const PAGE_SIZE = 20;
export const COLLABORATOR_CHECK_CONCURRENCY = 4;
export const CACHE_SYNC_CONCURRENCY = 4;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        break;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

export function sortByUpdatedAtDesc<T extends LocalDocumentEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => toSortableTimestamp(b.meta.updatedAt) - toSortableTimestamp(a.meta.updatedAt)
  );
}

export function mergeUniqueDocuments<T extends LocalDocumentEntry>(base: T[], incoming: T[]): T[] {
  if (incoming.length === 0) {
    return base;
  }

  const byId = new Map(base.map((doc) => [doc.id, doc]));
  incoming.forEach((doc) => {
    byId.set(doc.id, doc);
  });

  return sortByUpdatedAtDesc(Array.from(byId.values()));
}

export function updateDocumentMetaInList<T extends LocalDocumentEntry>(
  entries: T[],
  id: string,
  meta: DocumentMeta
): { entries: T[]; exists: boolean } {
  const exists = entries.some((doc) => doc.id === id);

  if (!exists) {
    return { entries, exists: false };
  }

  return {
    entries: sortByUpdatedAtDesc(entries.map((doc) => (doc.id === id ? { ...doc, meta } : doc))),
    exists: true,
  };
}

export function combineSharedDocuments(
  sharedWithMeDocuments: SharedDocumentEntry[],
  ownerSharedDocuments: SharedDocumentEntry[]
): SharedDocumentEntry[] {
  return mergeUniqueDocuments(sharedWithMeDocuments, ownerSharedDocuments);
}

export async function classifyOwnedDocuments(
  docs: LocalDocumentEntry[],
  isAuthenticated: boolean,
  accessToken: string | null
): Promise<{ privateDocs: LocalDocumentEntry[]; sharedByOwnerDocs: SharedDocumentEntry[] }> {
  if (!isAuthenticated || !accessToken || docs.length === 0) {
    return { privateDocs: docs, sharedByOwnerDocs: [] };
  }

  const checks = await mapWithConcurrency(docs, COLLABORATOR_CHECK_CONCURRENCY, async (doc) => {
    try {
      const collaborators = await documentService.listCollaborators(doc.id, accessToken);
      const hasExtraUser = collaborators.some(
        (collaborator) => collaborator.accessLevel !== 'OWNER'
      );
      return { doc, hasExtraUser };
    } catch (error) {
      console.warn(`Failed to resolve collaborators for document ${doc.id}:`, error);
      return { doc, hasExtraUser: false };
    }
  });

  return {
    privateDocs: checks.filter((entry) => !entry.hasExtraUser).map((entry) => entry.doc),
    sharedByOwnerDocs: checks
      .filter((entry) => entry.hasExtraUser)
      .map((entry) => ({ ...entry.doc, relationship: 'owner' })),
  };
}

export async function ensureCloudDocsCachedLocally(
  docs: { id: string; meta: DocumentMeta }[],
  isAuthenticated: boolean,
  accessToken: string | null,
  isCloudUnavailable: boolean,
  cacheSyncInFlight: Set<string>
): Promise<void> {
  if (!isAuthenticated || !accessToken || docs.length === 0 || isCloudUnavailable) {
    return;
  }

  let localMetaEntries: { id: string; meta: DocumentMeta }[] = [];
  try {
    localMetaEntries = await documentService.getAllDocumentsMeta();
  } catch (error) {
    console.warn('Failed to read local documents for cache sync:', error);
  }

  const localUpdatedAtById = new Map(
    localMetaEntries.map((entry) => [entry.id, toSortableTimestamp(entry.meta.updatedAt)])
  );

  const docsToCache = docs.filter((doc) => {
    const localUpdatedAt = localUpdatedAtById.get(doc.id);
    if (localUpdatedAt == null) {
      return true;
    }

    return localUpdatedAt < toSortableTimestamp(doc.meta.updatedAt);
  });

  await mapWithConcurrency(docsToCache, CACHE_SYNC_CONCURRENCY, async (doc) => {
    const flightKey = `${doc.id}:${doc.meta.updatedAt}`;
    if (cacheSyncInFlight.has(flightKey)) {
      return;
    }

    cacheSyncInFlight.add(flightKey);

    try {
      const cloudDoc = await documentService.getCloudDocument(doc.id, accessToken);
      await documentService.saveDocument(doc.id, cloudDoc.ydoc, cloudDoc.meta, {
        touchUpdatedAt: false,
      });
    } catch (error) {
      console.warn(`Failed to cache cloud document ${doc.id} locally:`, error);
    } finally {
      cacheSyncInFlight.delete(flightKey);
    }
  });
}
