'use client';

import { isConnectivityError } from '@/lib/cloud-connectivity.util';
import { generateDocumentId } from '@/lib/document-id.util';
import { queuePendingCloudCreate } from '@/lib/pending-cloud-create.util';
import { toSortableTimestamp } from '@/lib/timestamp.util';
import { documentService } from '@/services/document.service';
import type { DocumentLoadResult, DocumentMeta } from '@/types/document.types';

interface LocalLoadedDocument {
  id: string;
  result: DocumentLoadResult;
}

interface LocalDocumentSnapshot {
  id: string;
  ydoc: DocumentLoadResult['ydoc'];
  meta: DocumentMeta;
}

export interface ResolveRootDocumentOptions {
  isAuthenticated: boolean;
  accessToken: string | null;
  excludedDocumentIds?: string[];
  title?: string;
  userId?: string | null;
}

function normalizeDocumentTitle(title: string | undefined): string {
  return title?.trim() ? title : 'Untitled';
}

function sortByRecency(
  docs: {
    id: string;
    meta: DocumentMeta;
  }[]
): {
  id: string;
  meta: DocumentMeta;
}[] {
  return [...docs].sort((a, b) => {
    const updatedAtDiff =
      toSortableTimestamp(b.meta.updatedAt) - toSortableTimestamp(a.meta.updatedAt);
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    const createdAtDiff =
      toSortableTimestamp(b.meta.createdAt) - toSortableTimestamp(a.meta.createdAt);
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return a.id.localeCompare(b.id);
  });
}

async function getMostRecentLocalDocument(
  excludedDocumentIds: ReadonlySet<string>
): Promise<LocalLoadedDocument | null> {
  const localDocs = (await documentService.getAllDocumentsMeta()).filter(
    (doc) => !excludedDocumentIds.has(doc.id)
  );

  if (localDocs.length === 0) {
    return null;
  }

  const [mostRecentLocalDoc] = sortByRecency(localDocs);
  const loaded = await documentService.loadDocument(mostRecentLocalDoc.id);
  if (!loaded) {
    return null;
  }

  return {
    id: mostRecentLocalDoc.id,
    result: loaded,
  };
}

async function createLocalDocumentSnapshot(title?: string): Promise<LocalDocumentSnapshot> {
  const id = generateDocumentId();
  const created = await documentService.createDocument(title);
  return {
    id,
    ydoc: created.ydoc,
    meta: created.meta,
  };
}

async function persistLocalDocument(snapshot: LocalDocumentSnapshot): Promise<string> {
  await documentService.saveDocument(snapshot.id, snapshot.ydoc, snapshot.meta, {
    touchUpdatedAt: false,
  });
  documentService.emitLocalDocumentsChanged();
  return snapshot.id;
}

async function migrateLocalDocumentToCloud(
  localDoc: LocalLoadedDocument,
  accessToken: string
): Promise<string> {
  const normalizedTitle = normalizeDocumentTitle(localDoc.result.meta.title);
  const created = await documentService.createCloudDocument(
    accessToken,
    localDoc.id,
    normalizedTitle,
    localDoc.result.ydoc,
    localDoc.result.meta.createdBy ?? null
  );

  try {
    await documentService.saveDocument(localDoc.id, localDoc.result.ydoc, created.meta, {
      touchUpdatedAt: false,
    });
  } catch (cacheError) {
    console.warn('Failed to cache migrated cloud document locally:', cacheError);
  }

  documentService.emitCloudDocumentsChanged();
  documentService.emitLocalDocumentsChanged();
  return created.id;
}

async function getMostRecentCloudDocumentId(
  accessToken: string,
  excludedDocumentIds: ReadonlySet<string>
): Promise<string | null> {
  const cloudPage = await documentService.listCloudDocuments(accessToken, 0, 20);
  const mostRecentCloudDocument = cloudPage.items.find((doc) => !excludedDocumentIds.has(doc.id));
  return mostRecentCloudDocument?.id ?? null;
}

export async function resolveRootDocumentId(
  options: ResolveRootDocumentOptions
): Promise<string | null> {
  // Guests have no private workspace: they reach documents only through a
  // share link, so there is no root document to resolve for them.
  if (!options.isAuthenticated || !options.accessToken) {
    return null;
  }

  const accessToken = options.accessToken;
  const excludedDocumentIds = new Set(options.excludedDocumentIds ?? []);
  const mostRecentLocalDocument = await getMostRecentLocalDocument(excludedDocumentIds);

  try {
    const mostRecentCloudDocumentId = await getMostRecentCloudDocumentId(
      accessToken,
      excludedDocumentIds
    );

    if (mostRecentCloudDocumentId) {
      return mostRecentCloudDocumentId;
    }

    if (mostRecentLocalDocument) {
      return await migrateLocalDocumentToCloud(mostRecentLocalDocument, accessToken);
    }

    const normalizedTitle = normalizeDocumentTitle(options.title);
    const localSnapshot = await createLocalDocumentSnapshot(normalizedTitle);
    const createdCloudDocument = await documentService.createCloudDocument(
      accessToken,
      localSnapshot.id,
      normalizedTitle,
      localSnapshot.ydoc,
      localSnapshot.meta.createdBy ?? null
    );

    try {
      await documentService.saveDocument(
        localSnapshot.id,
        localSnapshot.ydoc,
        createdCloudDocument.meta,
        { touchUpdatedAt: false }
      );
    } catch (cacheError) {
      console.warn('Failed to cache newly created cloud document locally:', cacheError);
    }

    documentService.emitCloudDocumentsChanged();
    documentService.emitLocalDocumentsChanged();
    return createdCloudDocument.id;
  } catch (error) {
    if (!isConnectivityError(error)) {
      throw error;
    }

    if (mostRecentLocalDocument) {
      return mostRecentLocalDocument.id;
    }

    const id = await persistLocalDocument(
      await createLocalDocumentSnapshot(normalizeDocumentTitle(options.title))
    );
    if (options.userId) {
      queuePendingCloudCreate({ id, userId: options.userId, parentId: null });
    }
    return id;
  }
}
