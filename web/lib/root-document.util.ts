'use client';

import { isConnectivityError } from '@/lib/cloud-connectivity.util';
import { generateDocumentId } from '@/lib/document-id.util';
import { toSortableTimestamp } from '@/lib/timestamp.util';
import { documentService } from '@/services/document.service';
import type { DocumentLoadResult, DocumentMeta } from '@/types/document.types';

interface LocalLoadedDocument {
  id: string;
  result: DocumentLoadResult;
}

export interface ResolveRootDocumentOptions {
  isAuthenticated: boolean;
  accessToken: string | null;
  excludedDocumentIds?: string[];
  title?: string;
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

async function createLocalDocument(): Promise<string> {
  const newDocumentId = generateDocumentId();
  const created = await documentService.createDocument();
  await documentService.saveDocument(newDocumentId, created.ydoc, created.meta, {
    touchUpdatedAt: false,
  });
  documentService.emitLocalDocumentsChanged();
  return newDocumentId;
}

async function migrateLocalDocumentToCloud(
  localDoc: LocalLoadedDocument,
  accessToken: string
): Promise<string> {
  const normalizedTitle = normalizeDocumentTitle(localDoc.result.meta.title);
  const created = await documentService.createCloudDocument(
    accessToken,
    normalizedTitle,
    localDoc.id
  );

  try {
    await documentService.saveCloudDocument(
      created.id,
      localDoc.result.ydoc,
      {
        ...localDoc.result.meta,
        title: normalizedTitle,
      },
      accessToken
    );
  } catch (saveError) {
    try {
      await documentService.deleteCloudDocumentPermanently(created.id, accessToken);
    } catch (rollbackError) {
      console.error(
        'Failed to rollback partially-created cloud document during root local migration:',
        rollbackError
      );
    }

    throw saveError;
  }

  try {
    await documentService.saveDocument(
      created.id,
      localDoc.result.ydoc,
      {
        ...localDoc.result.meta,
        title: normalizedTitle,
      },
      { touchUpdatedAt: false }
    );
  } catch (cacheError) {
    console.warn('Failed to cache migrated cloud document locally:', cacheError);
  }

  if (created.id !== localDoc.id) {
    try {
      await documentService.deleteDocument(localDoc.id);
    } catch (deleteError) {
      console.warn('Failed to remove old local document after cloud migration:', deleteError);
    }
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

export async function resolveRootDocumentId(options: ResolveRootDocumentOptions): Promise<string> {
  const excludedDocumentIds = new Set(options.excludedDocumentIds ?? []);
  const mostRecentLocalDocument = await getMostRecentLocalDocument(excludedDocumentIds);

  if (options.isAuthenticated && options.accessToken) {
    try {
      const mostRecentCloudDocumentId = await getMostRecentCloudDocumentId(
        options.accessToken,
        excludedDocumentIds
      );

      if (mostRecentCloudDocumentId) {
        return mostRecentCloudDocumentId;
      }

      if (mostRecentLocalDocument) {
        return await migrateLocalDocumentToCloud(mostRecentLocalDocument, options.accessToken);
      }

      const normalizedTitle = normalizeDocumentTitle(options.title);
      const createdCloudDocument = await documentService.createCloudDocument(
        options.accessToken,
        normalizedTitle
      );
      const createdCloudDocumentMeta = {
        ...createdCloudDocument.meta,
        title: normalizedTitle,
      };

      try {
        await documentService.saveDocument(
          createdCloudDocument.id,
          createdCloudDocument.ydoc,
          createdCloudDocumentMeta,
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

      return createLocalDocument();
    }
  }

  if (mostRecentLocalDocument) {
    return mostRecentLocalDocument.id;
  }

  return createLocalDocument();
}
