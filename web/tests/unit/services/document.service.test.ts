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

    it('should update updatedAt timestamp', async () => {
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
});
