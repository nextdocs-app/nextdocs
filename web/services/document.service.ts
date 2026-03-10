import * as Y from 'yjs';
import { indexedDBService } from './indexed-db.service';
import {
  createYjsDoc,
  encodeYjsState,
  decodeYjsState,
  createDefaultDocumentMeta,
} from '@/lib/yjs.util';
import type { DocumentMeta, DocumentLoadResult } from '@/types/document.types';

const CURRENT_SCHEMA_VERSION = 1;

class DocumentService {
  public async loadDocument(id: string): Promise<DocumentLoadResult | null> {
    const storedDoc = await indexedDBService.getDocument(id);

    if (!storedDoc) {
      return null;
    }

    const ydoc = decodeYjsState(storedDoc.yjsState);

    return {
      ydoc,
      meta: storedDoc.meta,
    };
  }

  public async saveDocument(id: string, ydoc: Y.Doc, meta: DocumentMeta): Promise<void> {
    try {
      // We store Yjs state as binary for efficient sync and future backend compatibility
      const yjsState = encodeYjsState(ydoc);

      const updatedMeta: DocumentMeta = {
        ...meta,
        updatedAt: new Date().toISOString(),
      };

      await indexedDBService.saveDocument({
        id,
        meta: updatedMeta,
        yjsState,
        version: CURRENT_SCHEMA_VERSION,
      });
    } catch (error) {
      console.error('Failed to save document:', error);
      throw error;
    }
  }

  public async createDocument(title?: string): Promise<{ ydoc: Y.Doc; meta: DocumentMeta }> {
    const meta = createDefaultDocumentMeta(title);
    const ydoc = createYjsDoc();

    return { ydoc, meta };
  }

  public async deleteDocument(id: string): Promise<void> {
    try {
      await indexedDBService.deleteDocument(id);
    } catch (error) {
      console.error('Failed to delete document:', error);
      throw error;
    }
  }

  public async documentExists(id: string): Promise<boolean> {
    const doc = await indexedDBService.getDocument(id);
    return doc !== undefined;
  }

  public async getOrCreateDocument(id: string, title?: string): Promise<DocumentLoadResult> {
    const existing = await this.loadDocument(id);

    if (existing) {
      return existing;
    }

    const { ydoc, meta } = await this.createDocument(title);
    await this.saveDocument(id, ydoc, meta);

    return { ydoc, meta };
  }

  public async getAllDocumentsMeta(): Promise<{ id: string; meta: DocumentMeta }[]> {
    try {
      const docs = await indexedDBService.getAllDocuments();
      return docs.map((doc) => ({ id: doc.id, meta: doc.meta }));
    } catch (error) {
      console.error('Failed to get all documents:', error);
      return [];
    }
  }

  public async updateMetadata(id: string, updates: Partial<DocumentMeta>): Promise<void> {
    try {
      const storedDoc = await indexedDBService.getDocument(id);

      if (!storedDoc) {
        throw new Error('Document not found');
      }

      const updatedMeta: DocumentMeta = {
        ...storedDoc.meta,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      await indexedDBService.saveDocument({
        ...storedDoc,
        meta: updatedMeta,
      });
    } catch (error) {
      console.error('Failed to update metadata:', error);
      throw error;
    }
  }
}

export const documentService = new DocumentService();
