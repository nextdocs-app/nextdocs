import { render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import RootDocumentResolver from '../../../components/RootDocumentResolver';
import { useAuth } from '../../../hooks/useAuth.hook';
import { documentService } from '../../../services/document.service';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../lib/document-id.util', () => ({
  generateDocumentId: jest.fn(() => 'generated-local-id'),
}));

jest.mock('../../../services/document.service', () => ({
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
}));

describe('RootDocumentResolver', () => {
  const mockReplace = jest.fn();

  const defaultMeta = {
    title: 'Untitled',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (useRouter as jest.Mock).mockReturnValue({
      replace: mockReplace,
    });

    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: false,
      accessToken: null,
    });

    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([]);
    (documentService.loadDocument as jest.Mock).mockResolvedValue(null);
    (documentService.listCloudDocuments as jest.Mock).mockResolvedValue({
      items: [],
      page: 0,
      size: 1,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
    (documentService.createCloudDocument as jest.Mock).mockResolvedValue({
      id: 'generated-local-id',
      ydoc: new Y.Doc(),
      meta: defaultMeta,
    });
    (documentService.saveCloudDocument as jest.Mock).mockResolvedValue(undefined);
    (documentService.deleteCloudDocumentPermanently as jest.Mock).mockResolvedValue(undefined);
    (documentService.saveDocument as jest.Mock).mockResolvedValue(undefined);
    (documentService.deleteDocument as jest.Mock).mockResolvedValue(undefined);
    (documentService.createDocument as jest.Mock).mockResolvedValue({
      ydoc: new Y.Doc(),
      meta: defaultMeta,
    });
  });

  it('should route guest users to the most recently edited local document', async () => {
    const localYDoc = new Y.Doc();
    const localMeta = {
      title: 'Recent local',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
    };

    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
      {
        id: 'local-old',
        meta: {
          title: 'Old local',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      {
        id: 'local-recent',
        meta: localMeta,
      },
    ]);
    (documentService.loadDocument as jest.Mock).mockResolvedValue({
      ydoc: localYDoc,
      meta: localMeta,
    });

    render(<RootDocumentResolver />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/doc/local-recent');
    });

    expect(documentService.createDocument).not.toHaveBeenCalled();
  });

  it('should create a new local document at root when guest has no documents', async () => {
    const createdYDoc = new Y.Doc();
    const createdMeta = {
      title: 'Untitled',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([]);
    (documentService.createDocument as jest.Mock).mockResolvedValue({
      ydoc: createdYDoc,
      meta: createdMeta,
    });

    render(<RootDocumentResolver />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/doc/generated-local-id');
    });

    expect(documentService.saveDocument).toHaveBeenCalledWith(
      'generated-local-id',
      createdYDoc,
      createdMeta,
      { touchUpdatedAt: false }
    );
  });

  it('should route authenticated users to latest cloud document when available', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    (documentService.listCloudDocuments as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'cloud-latest',
          meta: defaultMeta,
        },
      ],
      page: 0,
      size: 1,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    render(<RootDocumentResolver />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/doc/cloud-latest');
    });

    expect(documentService.createCloudDocument).not.toHaveBeenCalled();
  });

  it('should migrate latest local document when authenticated root has no cloud docs', async () => {
    const localYDoc = new Y.Doc();
    const localMeta = {
      title: 'Recent local',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      accessToken: 'token-2',
    });
    (documentService.listCloudDocuments as jest.Mock).mockResolvedValue({
      items: [],
      page: 0,
      size: 1,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
      { id: 'local-recent', meta: localMeta },
    ]);
    (documentService.loadDocument as jest.Mock).mockResolvedValue({
      ydoc: localYDoc,
      meta: localMeta,
    });
    (documentService.createCloudDocument as jest.Mock).mockResolvedValue({
      id: 'local-recent',
      ydoc: new Y.Doc(),
      meta: localMeta,
    });

    render(<RootDocumentResolver />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/doc/local-recent');
    });

    expect(documentService.createCloudDocument).toHaveBeenCalledWith(
      'token-2',
      'local-recent',
      'Recent local',
      localYDoc,
      null
    );
    expect(documentService.saveDocument).toHaveBeenCalledWith(
      'local-recent',
      localYDoc,
      expect.objectContaining({ title: 'Recent local' }),
      { touchUpdatedAt: false }
    );
    expect(documentService.deleteDocument).not.toHaveBeenCalled();
  });
});
