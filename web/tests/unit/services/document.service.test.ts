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

  describe('updateCloudMetadata', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    });

    function mockOkFetch() {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'id-1',
            title: 'Untitled',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;
      return fetchMock;
    }

    it('should send Untitled instead of a blank title', async () => {
      const fetchMock = mockOkFetch();

      await documentService.updateCloudMetadata('id-1', { title: '' }, 'token');

      expect(fetchMock.mock.calls[0][1]?.body).toContain('"title":"Untitled"');
    });

    it('should send Untitled instead of a whitespace-only title', async () => {
      const fetchMock = mockOkFetch();

      await documentService.updateCloudMetadata('id-1', { title: '   ' }, 'token');

      expect(fetchMock.mock.calls[0][1]?.body).toContain('"title":"Untitled"');
    });

    it('should pass through a non-blank title unchanged', async () => {
      const fetchMock = mockOkFetch();

      await documentService.updateCloudMetadata('id-1', { title: 'Hello' }, 'token');

      expect(fetchMock.mock.calls[0][1]?.body).toContain('"title":"Hello"');
    });

    it('should keep the blank-title invariant on the anonymous PATCH too', async () => {
      const fetchMock = mockOkFetch();

      await documentService.updatePublicMetadata('id-1', { title: '   ' });

      expect(fetchMock.mock.calls[0][1]?.body).toContain('"title":"Untitled"');
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

  describe('getMyAccess', () => {
    it('should fetch and return document access including trashed status', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            documentId: 'doc-123',
            allowed: true,
            accessLevel: 'EDIT',
            owner: false,
            trashed: true,
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const access = await documentService.getMyAccess('doc-123', 'access-token');

      expect(access).toEqual({
        documentId: 'doc-123',
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
        trashed: true,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/documents/doc-123/my-access'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
          }),
        })
      );
    });
  });

  describe('checkAccess', () => {
    it('should call access-check without an Authorization header for guests', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            documentId: 'doc-123',
            allowed: true,
            accessLevel: 'EDIT',
            owner: false,
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const access = await documentService.checkAccess('doc-123');

      expect(access.accessLevel).toBe('EDIT');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/documents/doc-123/access-check'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    });

    it('should attach the bearer token when provided', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { documentId: 'doc-123', allowed: false, accessLevel: null, owner: false },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const access = await documentService.checkAccess('doc-123', 'tok');

      expect(access.allowed).toBe(false);
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer tok',
      });
    });

    it('should map a malformed access level to null instead of trusting it', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            documentId: 'doc-123',
            allowed: true,
            accessLevel: 'SUPERADMIN',
            owner: false,
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const access = await documentService.checkAccess('doc-123');

      expect(access.accessLevel).toBeNull();
    });
  });

  describe('listPublicChildren', () => {
    it('should map public children without an Authorization header', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            content: [
              {
                id: 'child-1',
                title: 'Inherited Task',
                parentId: 'parent-1',
                orderKey: 'a0',
                hasChildren: false,
                accessLevel: 'VIEW',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-02T00:00:00.000Z',
              },
            ],
            totalElements: 1,
            totalPages: 1,
            size: 50,
            number: 0,
            first: true,
            last: true,
          },
          error: null,
        }),
      } as unknown as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const page = await documentService.listPublicChildren('parent-1');

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: 'child-1',
        title: 'Inherited Task',
        parentId: 'parent-1',
        effectiveAccessLevel: 'VIEW',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/documents/parent-1/public/children'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    });

    it('should fall back to VIEW for a malformed child access level', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            content: [
              {
                id: 'child-9',
                title: 'Odd',
                parentId: 'parent-1',
                orderKey: 'a0',
                hasChildren: false,
                accessLevel: 'SUPERADMIN',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-02T00:00:00.000Z',
              },
            ],
            totalElements: 1,
            totalPages: 1,
            size: 50,
            number: 0,
            first: true,
            last: true,
          },
          error: null,
        }),
      } as unknown as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const page = await documentService.listPublicChildren('parent-1');

      expect(page.items[0].effectiveAccessLevel).toBe('VIEW');
    });
  });

  describe('savePublicDocument', () => {
    it('should PATCH the public endpoint without an Authorization header', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'doc-123',
            title: 'Guest edit',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const { ydoc } = await documentService.createDocument('Guest edit');
      await documentService.savePublicDocument('doc-123', ydoc, {
        title: 'Guest edit',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/documents/doc-123/public'),
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
      expect(fetchMock.mock.calls[0][1]?.body).toContain('Guest edit');
    });
  });

  describe('getCloudDocument', () => {
    it('should not append includeTrashed query param by default', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'doc-123',
            title: 'Doc',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.getCloudDocument('doc-123', 'access-token');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/documents/doc-123',
        expect.anything()
      );
    });

    it('should append includeTrashed=true when explicitly requested', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'doc-123',
            title: 'Doc',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.getCloudDocument('doc-123', 'access-token', {
        includeTrashed: true,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/documents/doc-123?includeTrashed=true',
        expect.anything()
      );
    });

    it('should support legacy boolean param for includeTrashed', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'doc-123',
            title: 'Doc',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.getCloudDocument(
        'doc-123',
        'access-token',
        true as unknown as { includeTrashed: boolean }
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/documents/doc-123?includeTrashed=true',
        expect.anything()
      );
    });
  });

  describe('fetchApi error message handling', () => {
    it('should prioritize message over error when both are provided', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          data: null,
          error: 'Validation failed',
          message: 'parentId cannot be combined with trashed=true',
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await expect(documentService.getCloudDocument('doc-123', 'access-token')).rejects.toThrow(
        'parentId cannot be combined with trashed=true'
      );
    });

    it('should fall back to error when message is omitted', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          data: null,
          error: 'Validation failed',
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await expect(documentService.getCloudDocument('doc-123', 'access-token')).rejects.toThrow(
        'Validation failed'
      );
    });
  });

  describe('request coalescing', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('should coalesce concurrent identical breadcrumb fetches into one request', async () => {
      let resolveJson!: (v: unknown) => void;
      const jsonPromise = new Promise((resolve) => {
        resolveJson = resolve;
      });
      const fetchMock = jest.fn().mockReturnValue(
        Promise.resolve({
          ok: true,
          json: () => jsonPromise,
        })
      );
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const first = documentService.getDocumentBreadcrumbs('doc-1');
      const second = documentService.getDocumentBreadcrumbs('doc-1');
      resolveJson({
        success: true,
        data: [{ id: 'doc-1', title: 'Doc', parentId: null }],
        error: null,
      });

      const [a, b] = await Promise.all([first, second]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it('should not share in-flight requests across different documents', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [], error: null }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await Promise.all([
        documentService.getDocumentBreadcrumbs('doc-1'),
        documentService.getDocumentBreadcrumbs('doc-2'),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should attach Retry-After milliseconds on 429 errors', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === 'Retry-After' ? '60' : null) },
        json: async () => ({ success: false, data: null, error: 'Too many requests' }),
      } as unknown as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const err = await documentService.checkAccess('doc-1').catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(60_000);
    });
  });

  describe('public-link origin tagging', () => {
    it('should persist and preserve the origin across re-saves', async () => {
      const { ydoc, meta } = await documentService.createDocument('Linked');
      await documentService.saveDocument('link-1', ydoc, meta, { origin: 'public-link' });

      const loaded = await documentService.loadDocument('link-1');
      expect(loaded?.origin).toBe('public-link');

      await documentService.saveDocument('link-1', ydoc, { ...meta, title: 'Renamed' });
      expect((await documentService.loadDocument('link-1'))?.origin).toBe('public-link');
    });

    it('should exclude public-link mirrors from private listings', async () => {
      const linked = await documentService.createDocument('Linked');
      await documentService.saveDocument('link-1', linked.ydoc, linked.meta, {
        origin: 'public-link',
      });
      const mine = await documentService.createDocument('Mine');
      await documentService.saveDocument('mine-1', mine.ydoc, mine.meta);

      const allMeta = await documentService.getAllDocumentsMeta();
      expect(allMeta.map((d) => d.id)).toEqual(['mine-1']);
    });

    it('should exclude public-link mirrors from login promotion', async () => {
      const linked = await documentService.createDocument('Linked');
      await documentService.saveDocument('link-1', linked.ydoc, linked.meta, {
        origin: 'public-link',
      });

      expect(await documentService.getAllGuestDocuments()).toEqual([]);
    });

    it('should tag link-session documents created offline', async () => {
      const result = await documentService.getOrCreateDocument('link-2', undefined, {
        origin: 'public-link',
      });
      expect(result.origin).toBe('public-link');
      expect((await documentService.loadDocument('link-2'))?.origin).toBe('public-link');
    });

    it('should cap publicLinkSessionIds to 500 entries with FIFO eviction', () => {
      for (let i = 0; i < 505; i++) {
        documentService.notePublicLinkDocument(`doc-${i}`);
      }

      // Oldest entries 0..4 should have been evicted
      expect(documentService.isPublicLinkDocument('doc-0')).toBe(false);
      expect(documentService.isPublicLinkDocument('doc-4')).toBe(false);
      // Newer entries 5..504 should still be present
      expect(documentService.isPublicLinkDocument('doc-5')).toBe(true);
      expect(documentService.isPublicLinkDocument('doc-504')).toBe(true);
    });

    it('should clear session registries with clearSessionRegistries', () => {
      documentService.notePublicLinkDocument('link-test');
      expect(documentService.isPublicLinkDocument('link-test')).toBe(true);

      documentService.clearSessionRegistries();
      expect(documentService.isPublicLinkDocument('link-test')).toBe(false);
    });

    it('should not query IndexedDB on saveDocument to look up origin', async () => {
      const { ydoc, meta } = await documentService.createDocument('No DB Read');
      const getSpy = jest.spyOn(indexedDBService, 'getDocument');

      await documentService.saveDocument('no-read-doc', ydoc, meta);
      expect(getSpy).not.toHaveBeenCalled();
      getSpy.mockRestore();
    });
  });
});
