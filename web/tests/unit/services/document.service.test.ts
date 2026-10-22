import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { documentService, iconCoverPatch } from '@/services/document.service';
import { indexedDBService } from '@/services/indexed-db.service';
import { getLocalDocumentParents, setLocalDocumentParent } from '@/lib/local-tree.util';

describe('document.service', () => {
  beforeAll(() => {
    // Private local listings require a signed-in database context.
    indexedDBService.setUserId('document-service-test-user');
  });

  afterAll(() => {
    indexedDBService.setUserId(null);
  });

  beforeEach(async () => {
    window.localStorage.clear();
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

    it('remembers the parent the backend accepted', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'id-1',
            title: 'Doc 1',
            parentId: 'parent-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.createCloudDocument(
        'access-token',
        'id-1',
        'Doc 1',
        undefined,
        undefined,
        'parent-1'
      );

      expect(getLocalDocumentParents().get('id-1')).toBe('parent-1');
    });

    it('clears a stale parent link when a replay lands at the root', async () => {
      setLocalDocumentParent('id-1', 'old-parent');
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'id-1',
            title: 'Doc 1',
            parentId: null,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.createCloudDocument(
        'access-token',
        'id-1',
        'Doc 1',
        undefined,
        undefined,
        null
      );

      expect(getLocalDocumentParents().get('id-1')).toBeNull();
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

  describe('moveDocument', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('remembers the new parent for an offline reload', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'doc-1',
            title: 'Doc 1',
            parentId: 'new-parent',
            orderKey: 'a0',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.moveDocument(
        'doc-1',
        { newParentId: 'new-parent', prevSiblingId: null, nextSiblingId: null },
        'access-token'
      );

      expect(getLocalDocumentParents().get('doc-1')).toBe('new-parent');
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

  describe('page icon and cover', () => {
    const ATTACHMENT_ID = '11111111-2222-4333-8444-555555555555';

    function mockDocumentFetch(data: Record<string, unknown>) {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'id-1',
            title: 'Doc',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            ...data,
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;
      return fetchMock;
    }

    it('maps a structured icon and cover onto the document meta', async () => {
      mockDocumentFetch({
        icon: { type: 'emoji', value: '📝' },
        cover: { type: 'upload', value: ATTACHMENT_ID, position: 0.25 },
      });

      const { meta } = await documentService.getCloudDocument('id-1', 'token');

      expect(meta.icon).toEqual({ type: 'emoji', value: '📝' });
      expect(meta.cover).toEqual({ type: 'upload', value: ATTACHMENT_ID, position: 0.25 });
    });

    it('drops an icon whose builtin slug could escape the catalog path', async () => {
      mockDocumentFetch({ icon: { type: 'builtin', value: '../../etc/passwd' } });

      const { meta } = await documentService.getCloudDocument('id-1', 'token');

      expect(meta.icon).toBeUndefined();
    });

    it('defaults a missing cover position to centred', async () => {
      mockDocumentFetch({ cover: { type: 'upload', value: ATTACHMENT_ID } });

      const { meta } = await documentService.getCloudDocument('id-1', 'token');

      expect(meta.cover?.position).toBe(0.5);
    });

    it('sends an explicit null payload to clear an icon', async () => {
      const fetchMock = mockDocumentFetch({});

      await documentService.updateCloudIconCover(
        'id-1',
        { icon: { type: null, value: null } },
        'token'
      );

      // Parsed JSON, not substring matching: key order must not matter.
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
        icon?: unknown;
      };
      expect(body.icon).toEqual({ type: null, value: null });
    });

    it('sends the focal position with a cover update', async () => {
      const fetchMock = mockDocumentFetch({});

      await documentService.updateCloudIconCover(
        'id-1',
        {
          cover: {
            type: 'upload',
            value: ATTACHMENT_ID,
            position: 0.8,
          },
        },
        'token'
      );

      expect(fetchMock.mock.calls[0][1]?.body).toContain('"position":0.8');
    });

    it('writes icon/cover for guests through the public endpoint', async () => {
      const fetchMock = mockDocumentFetch({});

      await documentService.updatePublicIconCover('id-1', {
        icon: { type: 'emoji', value: '🔥' },
      });

      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8080/api/v1/documents/id-1/public');
      expect(fetchMock.mock.calls[0][1]?.body).toContain('"value":"🔥"');
    });

    it('leaves the icon out of a content save when the page has none', async () => {
      const fetchMock = mockDocumentFetch({});
      const ydoc = new Y.Doc();

      await documentService.saveCloudDocument(
        'id-1',
        ydoc,
        {
          title: 'Doc',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        'token'
      );

      // Absent means "leave unchanged" on the API, which is what a content
      // save must say — it is not the metadata writer.
      expect(fetchMock.mock.calls[0][1]?.body).not.toContain('"icon"');
    });

    it('never sends icon/cover through the title-metadata endpoint', async () => {
      const fetchMock = mockDocumentFetch({});

      await documentService.updateCloudMetadata(
        'id-1',
        {
          title: 'Doc',
          icon: { type: 'emoji', value: '📝' },
          cover: { type: 'link', value: 'https://cdn.example/c.jpg', position: 0.5 },
        } as never,
        'token'
      );

      // Parsed JSON, not substring matching: an icon nested anywhere in the
      // payload must fail this, while a title containing the word must not.
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<
        string,
        unknown
      >;
      expect(body.title).toBe('Doc');
      expect(body).not.toHaveProperty('icon');
      expect(body).not.toHaveProperty('cover');
    });

    it('builds an icon/cover patch that clears, omits, or sets each value', () => {
      // Explicit null clears; an omitted key leaves the value unchanged.
      expect(iconCoverPatch({ icon: null })).toEqual({
        icon: { type: null, value: null },
      });
      expect(iconCoverPatch({})).toEqual({});
      expect(
        iconCoverPatch({
          icon: { type: 'emoji', value: '🔥' },
          cover: { type: 'link', value: 'https://cdn.example/c.jpg', position: 0.8 },
        })
      ).toEqual({
        icon: { type: 'emoji', value: '🔥' },
        cover: { type: 'link', value: 'https://cdn.example/c.jpg', position: 0.8 },
      });
    });

    it('includes icon and cover in a content save when the page has them', async () => {
      const fetchMock = mockDocumentFetch({});
      const ydoc = new Y.Doc();

      await documentService.saveCloudDocument(
        'id-1',
        ydoc,
        {
          title: 'Doc',
          icon: { type: 'emoji', value: '📝' },
          cover: { type: 'link', value: 'https://cdn.example/c.jpg', position: 0.25 },
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        'token'
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
        icon?: unknown;
        cover?: unknown;
      };
      expect(body.icon).toEqual({ type: 'emoji', value: '📝' });
      expect(body.cover).toEqual({
        type: 'link',
        value: 'https://cdn.example/c.jpg',
        position: 0.25,
      });
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

    it('should drop a hand-crafted icon from public children instead of rendering it', async () => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = jest
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              content: [
                {
                  id: 'child-evil',
                  title: 'Evil',
                  parentId: 'parent-1',
                  orderKey: 'a0',
                  hasChildren: false,
                  accessLevel: 'VIEW',
                  icon: { type: 'link', value: 'javascript:alert(1)' },
                  createdAt: '2024-01-01T00:00:00.000Z',
                  updatedAt: '2024-01-02T00:00:00.000Z',
                },
                {
                  id: 'child-good',
                  title: 'Good',
                  parentId: 'parent-1',
                  orderKey: 'a1',
                  hasChildren: false,
                  accessLevel: 'VIEW',
                  icon: { type: 'emoji', value: '📝' },
                  createdAt: '2024-01-01T00:00:00.000Z',
                  updatedAt: '2024-01-02T00:00:00.000Z',
                },
              ],
              totalElements: 2,
              totalPages: 1,
              size: 50,
              number: 0,
              first: true,
              last: true,
            },
            error: null,
          }),
        } as unknown as Response) as unknown as typeof fetch;

      const page = await documentService.listPublicChildren('parent-1');

      expect(page.items[0].icon).toBeNull();
      expect(page.items[1].icon).toEqual({ type: 'emoji', value: '📝' });
    });
  });

  describe('breadcrumb sanitization', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('should drop a hand-crafted breadcrumb icon instead of rendering it', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            { id: 'root-9', title: 'Root', parentId: null },
            {
              id: 'leaf-9',
              title: 'Leaf',
              parentId: 'root-9',
              icon: { type: 'builtin', value: '../../etc/passwd' },
            },
          ],
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const crumbs = await documentService.getDocumentBreadcrumbs('crumb-doc-evil');

      expect(crumbs[1].icon).toBeNull();
    });
  });

  describe('offline hierarchy caching', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    });

    function mockEnvelope(data: unknown): void {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = jest
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data, error: null }),
        } as Response) as typeof fetch;
    }

    it('caches every page of the private hierarchy once per signed-in user', async () => {
      const page = (content: Record<string, unknown>[], number: number, last: boolean): Response =>
        ({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              content,
              totalElements: 3,
              totalPages: 2,
              size: 200,
              number,
              first: number === 0,
              last,
            },
            error: null,
          }),
        }) as Response;
      const doc = (id: string, parentId: string | null) => ({
        id,
        title: id,
        parentId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(page([doc('parent', null), doc('child', 'parent')], 0, false))
        .mockResolvedValueOnce(page([doc('grandchild', 'child')], 1, true));
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      await documentService.cachePrivateHierarchy('token', 'warm-user');

      const parents = getLocalDocumentParents();
      expect(parents.get('child')).toBe('parent');
      expect(parents.get('grandchild')).toBe('child');

      await documentService.cachePrivateHierarchy('token', 'warm-user');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // The sweep is cached per account: a different user must not reuse it.
      fetchMock.mockResolvedValueOnce(page([], 0, true));
      await documentService.cachePrivateHierarchy('token', 'other-user');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not repopulate the hierarchy from a sweep started before logout', async () => {
      let resolvePage!: (response: Response) => void;
      const fetchMock = jest.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvePage = resolve;
          })
      );
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const sweep = documentService.cachePrivateHierarchy('token', 'warm-user');
      documentService.clearSessionRegistries();
      resolvePage({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            content: [
              {
                id: 'child',
                title: 'Child',
                parentId: 'parent',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
              },
            ],
            totalElements: 1,
            totalPages: 1,
            size: 200,
            number: 0,
            first: true,
            last: true,
          },
          error: null,
        }),
      } as Response);

      await sweep;

      expect(getLocalDocumentParents().has('child')).toBe(false);
    });

    it('remembers parents returned by a child tree fetch', async () => {
      mockEnvelope({
        content: [
          {
            id: 'child',
            title: 'Child',
            parentId: 'parent',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        totalElements: 1,
        totalPages: 1,
        size: 50,
        number: 0,
        first: true,
        last: true,
      });

      await documentService.listChildTreeNodes('parent', 'token');

      expect(getLocalDocumentParents().get('child')).toBe('parent');
    });

    it('remembers authenticated breadcrumb parents but not public paths', async () => {
      mockEnvelope([
        { id: 'parent', title: 'Parent', parentId: null },
        { id: 'child', title: 'Child', parentId: 'parent' },
      ]);

      await documentService.getDocumentBreadcrumbs('child', 'token');
      expect(getLocalDocumentParents().get('child')).toBe('parent');

      mockEnvelope([{ id: 'shared-child', title: 'Shared', parentId: 'shared-parent' }]);
      await documentService.getDocumentBreadcrumbs('shared-child');
      expect(getLocalDocumentParents().has('shared-child')).toBe(false);
    });
  });

  describe('listCollaborators', () => {
    it('should fall back malformed collaborator levels instead of trusting them', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              userId: 'u-1',
              email: 'a@example.com',
              displayName: 'A',
              accessLevel: 'SUPERADMIN',
              addedAt: '2024-01-01T00:00:00.000Z',
              inheritedAccessLevel: 'SUPERPOWER',
            },
          ],
          error: null,
        }),
      } as unknown as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const rows = await documentService.listCollaborators('doc-1', 'tok');

      expect(rows[0].accessLevel).toBe('VIEW');
      expect(rows[0].inheritedAccessLevel).toBeNull();
    });
  });

  describe('getSharingSettings', () => {
    it('should fall back malformed sharing mode and level', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            generalAccessMode: 'EVERYONE',
            linkAccessLevel: 'SUPERADMIN',
            hasActiveLink: true,
          },
          error: null,
        }),
      } as Response);
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

      const settings = await documentService.getSharingSettings('doc-1', 'tok');

      expect(settings.generalAccessMode).toBe('RESTRICTED');
      expect(settings.linkAccessLevel).toBe('VIEW');
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
