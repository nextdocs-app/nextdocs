import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { indexedDBService } from '@/services/indexed-db.service';
import type { StoredDocument } from '@/types/document.types';

describe('indexed-db.service', () => {
  beforeEach(async () => {
    await indexedDBService.clearAllDocuments();
  });

  describe('saveDocument and getDocument', () => {
    it('should save and retrieve a document', async () => {
      const doc: StoredDocument = {
        id: 'test-doc',
        meta: {
          title: 'Test Document',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1, 2, 3, 4]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc);
      const retrieved = await indexedDBService.getDocument('test-doc');

      expect(retrieved).toEqual(doc);
    });

    it('should return undefined for non-existent document', async () => {
      const retrieved = await indexedDBService.getDocument('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should update existing document', async () => {
      const doc: StoredDocument = {
        id: 'test-doc',
        meta: {
          title: 'Original Title',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1, 2, 3]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc);

      const updatedDoc: StoredDocument = {
        ...doc,
        meta: {
          ...doc.meta,
          title: 'Updated Title',
        },
      };

      await indexedDBService.saveDocument(updatedDoc);
      const retrieved = await indexedDBService.getDocument('test-doc');

      expect(retrieved?.meta.title).toBe('Updated Title');
    });
  });

  describe('deleteDocument', () => {
    it('should delete a document', async () => {
      const doc: StoredDocument = {
        id: 'test-doc',
        meta: {
          title: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1, 2, 3]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc);
      await indexedDBService.deleteDocument('test-doc');

      const retrieved = await indexedDBService.getDocument('test-doc');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllDocumentIds', () => {
    it('should return all document IDs', async () => {
      const doc1: StoredDocument = {
        id: 'doc-1',
        meta: {
          title: 'Doc 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1]),
        version: 1,
      };

      const doc2: StoredDocument = {
        id: 'doc-2',
        meta: {
          title: 'Doc 2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([2]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc1);
      await indexedDBService.saveDocument(doc2);

      const ids = await indexedDBService.getAllDocumentIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('doc-1');
      expect(ids).toContain('doc-2');
    });

    it('should return empty array when no documents exist', async () => {
      const ids = await indexedDBService.getAllDocumentIds();
      expect(ids).toEqual([]);
    });
  });

  describe('getAllDocuments', () => {
    it('should return all documents', async () => {
      const doc1: StoredDocument = {
        id: 'doc-1',
        meta: {
          title: 'Doc 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1]),
        version: 1,
      };

      const doc2: StoredDocument = {
        id: 'doc-2',
        meta: {
          title: 'Doc 2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([2]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc1);
      await indexedDBService.saveDocument(doc2);

      const docs = await indexedDBService.getAllDocuments();
      expect(docs).toHaveLength(2);
    });
  });

  describe('clearAllDocuments', () => {
    it('should clear all documents', async () => {
      const doc: StoredDocument = {
        id: 'test-doc',
        meta: {
          title: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc);
      await indexedDBService.clearAllDocuments();

      const ids = await indexedDBService.getAllDocumentIds();
      expect(ids).toEqual([]);
    });
  });

  describe('wipeDatabase', () => {
    it('should delete the current database and clear all documents', async () => {
      indexedDBService.setUserId('user-1');
      expect(indexedDBService.dbName).toBe('nextdocs-db_user-1');

      const doc: StoredDocument = {
        id: 'test-doc',
        meta: {
          title: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        yjsState: new Uint8Array([1]),
        version: 1,
      };

      await indexedDBService.saveDocument(doc);
      await indexedDBService.wipeDatabase();

      const retrieved = await indexedDBService.getDocument('test-doc');
      expect(retrieved).toBeUndefined();

      const ids = await indexedDBService.getAllDocumentIds();
      expect(ids).toEqual([]);
    });

    it('should switch databases when userId changes', async () => {
      indexedDBService.setUserId('user-A');
      const docA: StoredDocument = {
        id: 'doc-A',
        meta: { title: 'A', createdAt: '', updatedAt: '' },
        yjsState: new Uint8Array([65]),
        version: 1,
      };
      await indexedDBService.saveDocument(docA);

      indexedDBService.setUserId('user-B');
      const docB: StoredDocument = {
        id: 'doc-B',
        meta: { title: 'B', createdAt: '', updatedAt: '' },
        yjsState: new Uint8Array([66]),
        version: 1,
      };
      await indexedDBService.saveDocument(docB);

      expect(await indexedDBService.getDocument('doc-B')).toBeDefined();
      expect(await indexedDBService.getDocument('doc-A')).toBeUndefined();

      indexedDBService.setUserId('user-A');
      expect(await indexedDBService.getDocument('doc-A')).toBeDefined();
      expect(await indexedDBService.getDocument('doc-B')).toBeUndefined();
    });

    it('should honor the latest user context after rapid user switches', async () => {
      indexedDBService.setUserId('rapid-user-A');
      await indexedDBService.saveDocument({
        id: 'doc-rapid-A',
        meta: { title: 'A', createdAt: '', updatedAt: '' },
        yjsState: new Uint8Array([1]),
        version: 1,
      });

      indexedDBService.setUserId('rapid-user-B');
      indexedDBService.setUserId('rapid-user-C');
      indexedDBService.setUserId('rapid-user-B');

      await indexedDBService.saveDocument({
        id: 'doc-rapid-B',
        meta: { title: 'B', createdAt: '', updatedAt: '' },
        yjsState: new Uint8Array([2]),
        version: 1,
      });

      expect(indexedDBService.dbName).toBe('nextdocs-db_rapid-user-B');
      expect(await indexedDBService.getDocument('doc-rapid-B')).toBeDefined();

      indexedDBService.setUserId('rapid-user-A');
      expect(await indexedDBService.getDocument('doc-rapid-B')).toBeUndefined();
      expect(await indexedDBService.getDocument('doc-rapid-A')).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when IndexedDB is supported', () => {
      expect(indexedDBService.isAvailable()).toBe(true);
    });
  });

  describe('Guest Database Methods', () => {
    it('should operate on the guest database specifically', async () => {
      // Set a user context
      indexedDBService.setUserId('some-user');
      expect(indexedDBService.dbName).toBe('nextdocs-db_some-user');

      // Manually seed the legacy/guest database
      const guestDb = await openDB('nextdocs-db', 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('documents')) {
            db.createObjectStore('documents', { keyPath: 'id' });
          }
        },
      });
      await guestDb.put('documents', {
        id: 'guest-doc-1',
        meta: { title: 'Guest Doc', createdAt: '', updatedAt: '' },
        yjsState: new Uint8Array([1]),
        version: 1,
      });
      guestDb.close();

      // Verify getAllGuestDocuments finds it even with user context
      const guestDocs = await indexedDBService.getAllGuestDocuments();
      expect(guestDocs).toHaveLength(1);
      expect(guestDocs[0].id).toBe('guest-doc-1');

      // Verify it doesn't show up in the current user's documents
      const userDocs = await indexedDBService.getAllDocuments();
      expect(userDocs).toHaveLength(0);

      // Verify deletion from guest DB
      await indexedDBService.deleteGuestDocuments(['guest-doc-1']);
      const guestDocsAfterDelete = await indexedDBService.getAllGuestDocuments();
      expect(guestDocsAfterDelete).toHaveLength(0);
    });
  });
});
