import * as Y from 'yjs';
import { resolveRootDocumentId } from '@/lib/root-document.util';
import { listPendingCloudCreates, queuePendingCloudCreate } from '@/lib/pending-cloud-create.util';
import { documentService } from '@/services/document.service';

jest.mock('../../../lib/document-id.util', () => ({
  generateDocumentId: jest.fn(() => 'generated-local-id'),
}));

jest.mock('../../../services/document.service', () => {
  const actual = jest.requireActual('../../../services/document.service');
  return {
    ...actual,
    documentService: {
      getAllDocumentsMeta: jest.fn(),
      loadDocument: jest.fn(),
      listCloudDocuments: jest.fn(),
      createCloudDocument: jest.fn(),
      saveCloudDocument: jest.fn(),
      deleteCloudDocumentPermanently: jest.fn(),
      saveDocument: jest.fn(),
      deleteDocument: jest.fn(),
      createDocument: jest.fn(),
      emitCloudDocumentsChanged: jest.fn(),
      emitLocalDocumentsChanged: jest.fn(),
    },
  };
});

describe('resolveRootDocumentId', () => {
  const createdYDoc = new Y.Doc();
  const createdMeta = {
    title: 'Untitled',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([]);
    (documentService.loadDocument as jest.Mock).mockResolvedValue(null);
    (documentService.listCloudDocuments as jest.Mock).mockResolvedValue({
      items: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
    (documentService.createCloudDocument as jest.Mock).mockResolvedValue({
      id: 'generated-local-id',
      ydoc: createdYDoc,
      meta: createdMeta,
    });
    (documentService.createDocument as jest.Mock).mockResolvedValue({
      ydoc: createdYDoc,
      meta: createdMeta,
    });
    (documentService.saveDocument as jest.Mock).mockResolvedValue(undefined);
    (documentService.emitCloudDocumentsChanged as jest.Mock).mockImplementation(() => {});
    (documentService.emitLocalDocumentsChanged as jest.Mock).mockImplementation(() => {});
  });

  it('creates a new cloud root document with an Untitled fallback title', async () => {
    await expect(
      resolveRootDocumentId({
        isAuthenticated: true,
        accessToken: 'token-1',
      })
    ).resolves.toBe('generated-local-id');

    expect(documentService.createCloudDocument).toHaveBeenCalledWith(
      'token-1',
      'generated-local-id',
      'Untitled',
      expect.any(Y.Doc),
      null
    );
    expect(documentService.saveDocument).toHaveBeenCalledWith(
      'generated-local-id',
      createdYDoc,
      expect.objectContaining({ title: 'Untitled' }),
      { touchUpdatedAt: false }
    );
  });

  it('creates the root locally and queues the cloud create when offline', async () => {
    (documentService.listCloudDocuments as jest.Mock).mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    await expect(
      resolveRootDocumentId({
        isAuthenticated: true,
        accessToken: 'token-offline',
        userId: 'user-1',
      })
    ).resolves.toBe('generated-local-id');

    expect(documentService.createCloudDocument).not.toHaveBeenCalled();
    expect(listPendingCloudCreates('user-1')).toEqual([
      expect.objectContaining({ id: 'generated-local-id', parentId: null }),
    ]);
  });

  it('leaves a pending local document to the replay queue', async () => {
    const pendingMeta = { ...createdMeta, title: 'Pending child' };
    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
      { id: 'pending-child', meta: pendingMeta },
    ]);
    (documentService.loadDocument as jest.Mock).mockResolvedValue({
      ydoc: createdYDoc,
      meta: pendingMeta,
    });
    queuePendingCloudCreate({ id: 'pending-child', userId: 'user-1', parentId: 'parent-1' });

    await expect(
      resolveRootDocumentId({
        isAuthenticated: true,
        accessToken: 'token-1',
        userId: 'user-1',
      })
    ).resolves.toBe('pending-child');

    expect(documentService.createCloudDocument).not.toHaveBeenCalled();
  });

  it('uses a provided title when creating a new cloud root document', async () => {
    (documentService.createCloudDocument as jest.Mock).mockResolvedValue({
      id: 'generated-local-id',
      ydoc: createdYDoc,
      meta: {
        ...createdMeta,
        title: 'Project kickoff',
      },
    });

    await expect(
      resolveRootDocumentId({
        isAuthenticated: true,
        accessToken: 'token-2',
        title: 'Project kickoff',
      })
    ).resolves.toBe('generated-local-id');

    expect(documentService.createCloudDocument).toHaveBeenCalledWith(
      'token-2',
      'generated-local-id',
      'Project kickoff',
      expect.any(Y.Doc),
      null
    );
    expect(documentService.saveDocument).toHaveBeenCalledWith(
      'generated-local-id',
      createdYDoc,
      expect.objectContaining({ title: 'Project kickoff' }),
      { touchUpdatedAt: false }
    );
  });

  it('falls back to Untitled when the provided title is whitespace only', async () => {
    await expect(
      resolveRootDocumentId({
        isAuthenticated: true,
        accessToken: 'token-3',
        title: '   ',
      })
    ).resolves.toBe('generated-local-id');

    expect(documentService.createCloudDocument).toHaveBeenCalledWith(
      'token-3',
      'generated-local-id',
      'Untitled',
      expect.any(Y.Doc),
      null
    );
    expect(documentService.saveDocument).toHaveBeenCalledWith(
      'generated-local-id',
      createdYDoc,
      expect.objectContaining({ title: 'Untitled' }),
      { touchUpdatedAt: false }
    );
  });
});
