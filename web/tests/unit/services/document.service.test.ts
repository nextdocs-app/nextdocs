import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { documentService } from '@/services/document.service';
import { indexedDBService } from '@/services/indexed-db.service';

describe('document.service', () => {
  beforeEach(async () => {
    await indexedDBService.clearAllDocuments();
  });

  describe('createDocument', () => {
    it('should create a new document with default title', async () => {
      const { ydoc, meta } = await documentService.createDocument();

      expect(ydoc).toBeInstanceOf(Y.Doc);
      expect(meta.title).toBe('Untitled');
      expect(meta.createdAt).toBeDefined();
      expect(meta.updatedAt).toBeDefined();
    });

    it('should create a new document with custom title', async () => {
      const { meta } = await documentService.createDocument('Custom Title');

      expect(meta.title).toBe('Custom Title');
    });
  });

  describe('saveDocument', () => {
    it('should save document to IndexedDB', async () => {
      const ydoc = new Y.Doc();
      const fragment = ydoc.getXmlFragment('blocknote');
      const element = new Y.XmlElement('paragraph');
      fragment.push([element]);

      const meta = {
        title: 'Test Document',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await documentService.saveDocument('test-id', ydoc, meta);

      const stored = await indexedDBService.getDocument('test-id');
      expect(stored).toBeDefined();
      expect(stored?.meta.title).toBe('Test Document');
    });

    it('should update updatedAt timestamp by default', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await documentService.saveDocument('test-id', ydoc, meta);

      const stored = await indexedDBService.getDocument('test-id');
      expect(stored?.meta.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('should respect touchUpdatedAt: false option', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await documentService.saveDocument('test-id', ydoc, meta, { touchUpdatedAt: false });

      const stored = await indexedDBService.getDocument('test-id');
      expect(stored?.meta.updatedAt).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('loadDocument', () => {
    it('should load existing document', async () => {
      const { ydoc: originalDoc, meta } = await documentService.createDocument('Test');
      await documentService.saveDocument('test-id', originalDoc, meta);

      const loaded = await documentService.loadDocument('test-id');

      expect(loaded).toBeDefined();
      expect(loaded?.ydoc).toBeInstanceOf(Y.Doc);
      expect(loaded?.meta.title).toBe('Test');
    });

    it('should return null for non-existent document', async () => {
      const loaded = await documentService.loadDocument('non-existent');
      expect(loaded).toBeNull();
    });

    it('should propagate errors from IndexedDB', async () => {
      const dbError = new Error('IndexedDB read failed');
      const spy = jest.spyOn(indexedDBService, 'getDocument').mockRejectedValue(dbError);

      await expect(documentService.loadDocument('test-id')).rejects.toThrow(
        'IndexedDB read failed'
      );

      spy.mockRestore();
    });
  });

  describe('deleteDocument', () => {
    it('should delete document from IndexedDB', async () => {
      const { ydoc, meta } = await documentService.createDocument();
      await documentService.saveDocument('test-id', ydoc, meta);

      await documentService.deleteDocument('test-id');

      const stored = await indexedDBService.getDocument('test-id');
      expect(stored).toBeUndefined();
    });
  });

  describe('documentExists', () => {
    it('should return true for existing document', async () => {
      const { ydoc, meta } = await documentService.createDocument();
      await documentService.saveDocument('test-id', ydoc, meta);

      const exists = await documentService.documentExists('test-id');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent document', async () => {
      const exists = await documentService.documentExists('non-existent');
      expect(exists).toBe(false);
    });

    it('should propagate errors from IndexedDB', async () => {
      const dbError = new Error('IndexedDB read failed');
      const spy = jest.spyOn(indexedDBService, 'getDocument').mockRejectedValue(dbError);

      await expect(documentService.documentExists('test-id')).rejects.toThrow(
        'IndexedDB read failed'
      );

      spy.mockRestore();
    });
  });

  describe('getOrCreateDocument', () => {
    it('should return existing document if found', async () => {
      const { ydoc, meta } = await documentService.createDocument('Existing');
      await documentService.saveDocument('test-id', ydoc, meta);

      const result = await documentService.getOrCreateDocument('test-id');

      expect(result.meta.title).toBe('Existing');
    });

    it('should create new document if not found', async () => {
      const result = await documentService.getOrCreateDocument('new-id');

      expect(result.ydoc).toBeInstanceOf(Y.Doc);
      expect(result.meta.title).toBe('Untitled');

      const stored = await indexedDBService.getDocument('new-id');
      expect(stored).toBeDefined();
    });

    it('should create document with custom title', async () => {
      const result = await documentService.getOrCreateDocument('new-id', 'Custom');

      expect(result.meta.title).toBe('Custom');
    });

    it('should propagate errors from loadDocument', async () => {
      const dbError = new Error('IndexedDB read failed');
      const spy = jest.spyOn(indexedDBService, 'getDocument').mockRejectedValue(dbError);

      await expect(documentService.getOrCreateDocument('test-id')).rejects.toThrow(
        'IndexedDB read failed'
      );

      spy.mockRestore();
    });
  });

  describe('updateMetadata', () => {
    it('should update document metadata', async () => {
      const { ydoc, meta } = await documentService.createDocument('Original');
      await documentService.saveDocument('test-id', ydoc, meta);

      await documentService.updateMetadata('test-id', {
        title: 'Updated',
      });

      const stored = await indexedDBService.getDocument('test-id');
      expect(stored?.meta.title).toBe('Updated');
    });

    it('should update updatedAt timestamp', async () => {
      const { ydoc, meta } = await documentService.createDocument();
      await documentService.saveDocument('test-id', ydoc, meta);

      const originalUpdatedAt = meta.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      await documentService.updateMetadata('test-id', {
        title: 'Updated',
      });

      const stored = await indexedDBService.getDocument('test-id');
      expect(stored?.meta.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should throw error for non-existent document', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        documentService.updateMetadata('non-existent', { title: 'Test' })
      ).rejects.toThrow('Document not found');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('getAllDocumentsMeta', () => {
    it('should return meta for all stored documents', async () => {
      const doc1 = await documentService.createDocument('Doc 1');
      await documentService.saveDocument('id-1', doc1.ydoc, doc1.meta);

      const doc2 = await documentService.createDocument('Doc 2');
      await documentService.saveDocument('id-2', doc2.ydoc, doc2.meta);

      const allMeta = await documentService.getAllDocumentsMeta();

      expect(allMeta).toHaveLength(2);
      expect(allMeta).toContainEqual({
        id: 'id-1',
        meta: expect.objectContaining({ title: 'Doc 1' }),
      });
      expect(allMeta).toContainEqual({
        id: 'id-2',
        meta: expect.objectContaining({ title: 'Doc 2' }),
      });
    });

    it('should return empty array if no documents exist', async () => {
      const allMeta = await documentService.getAllDocumentsMeta();
      expect(allMeta).toEqual([]);
    });

    it('should handle errors and return empty array', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const spy = jest
        .spyOn(indexedDBService, 'getAllDocuments')
        .mockRejectedValue(new Error('DB Error'));

      const allMeta = await documentService.getAllDocumentsMeta();

      expect(allMeta).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      spy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('createCloudDocument', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('should send the requested client-generated id to the backend', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'id-1',
            title: 'Doc 1',
            yjsState: 'AQID',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await documentService.createCloudDocument('access-token', 'id-1', 'Doc 1');

      expect(result.id).toBe('id-1');
      expect(fetchMock).toHaveBeenCalled();
      expect(fetchMock.mock.calls[0][1]?.body).toContain('"id":"id-1"');
    });

    it('should throw when backend returns a different id', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'server-id',
            title: 'Doc 1',
            yjsState: 'AQID',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await expect(
        documentService.createCloudDocument('access-token', 'id-1', 'Doc 1')
      ).rejects.toThrow('server returned ID "server-id"');
    });
  });

  describe('promoteGuestDocumentsToAccount', () => {
    it('should cache promoted guest documents in the active user database', async () => {
      const cloudYDoc = new Y.Doc();
      const cloudMeta = {
        title: 'Doc 1',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };
      const createCloudDocumentSpy = jest
        .spyOn(documentService, 'createCloudDocument')
        .mockResolvedValue({
          id: 'id-1',
          ydoc: cloudYDoc,
          meta: cloudMeta,
        });

      const { ydoc, meta } = await documentService.createDocument('Doc 1');
      await documentService.saveDocument('id-1', ydoc, meta);
      const docs = await documentService.getAllLocalDocuments();
      await indexedDBService.clearAllDocuments();

      const result = await documentService.promoteGuestDocumentsToAccount('access-token', docs);

      expect(result).toEqual(['id-1']);
      expect(createCloudDocumentSpy).toHaveBeenCalledWith(
        'access-token',
        'id-1',
        'Doc 1',
        expect.any(Y.Doc),
        null
      );
      const stored = await indexedDBService.getDocument('id-1');
      expect(stored?.meta).toEqual(cloudMeta);

      createCloudDocumentSpy.mockRestore();
    });

    it('should propagate create failures during promotion', async () => {
      const createCloudDocumentSpy = jest
        .spyOn(documentService, 'createCloudDocument')
        .mockRejectedValue(new Error('Create failed'));

      const { ydoc, meta } = await documentService.createDocument('Doc 1');
      await documentService.saveDocument('id-1', ydoc, meta);
      const docs = await documentService.getAllLocalDocuments();

      await expect(
        documentService.promoteGuestDocumentsToAccount('access-token', docs)
      ).rejects.toThrow('Create failed');

      createCloudDocumentSpy.mockRestore();
    });
  });

  describe('deleteLocalDocumentsByIds', () => {
    it('should remove matching local documents and emit change event', async () => {
      const { ydoc: ydoc1, meta: meta1 } = await documentService.createDocument('Doc 1');
      await documentService.saveDocument('id-1', ydoc1, meta1);

      const { ydoc: ydoc2, meta: meta2 } = await documentService.createDocument('Doc 2');
      await documentService.saveDocument('id-2', ydoc2, meta2);

      const listener = jest.fn();
      window.addEventListener('local-documents-changed', listener);

      await documentService.deleteLocalDocumentsByIds(['id-1']);

      const doc1 = await indexedDBService.getDocument('id-1');
      const doc2 = await indexedDBService.getDocument('id-2');

      expect(doc1).toBeUndefined();
      expect(doc2).toBeDefined();
      expect(listener).toHaveBeenCalled();

      window.removeEventListener('local-documents-changed', listener);
    });
  });
});
