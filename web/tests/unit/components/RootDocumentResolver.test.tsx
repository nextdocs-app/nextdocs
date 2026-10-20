import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import RootDocumentResolver from '../../../components/RootDocumentResolver';
import uiReducer from '../../../stores/ui/ui.slice';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';
import { documentService } from '../../../services/document.service';
import { getPendingCloudCreate } from '../../../lib/pending-cloud-create.util';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../hooks/useNetworkStatus.hook', () => ({
  useNetworkStatus: jest.fn(),
}));

jest.mock('../../../components/editor', () => ({
  __esModule: true,
  default: ({ documentId }: { documentId: string }) => (
    <div data-testid="offline-editor">{documentId}</div>
  ),
}));

jest.mock('../../../lib/document-id.util', () => ({
  generateDocumentId: jest.fn(() => 'generated-local-id'),
}));

jest.mock('../../../services/document.service', () => {
  const actual = jest.requireActual('../../../services/document.service');
  return {
    DocumentServiceApiError: actual.DocumentServiceApiError,
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

describe('RootDocumentResolver', () => {
  const mockReplace = jest.fn();

  const defaultMeta = {
    title: 'Untitled',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  function renderResolver() {
    const store = configureStore({ reducer: { ui: uiReducer } });
    render(
      <Provider store={store}>
        <RootDocumentResolver />
      </Provider>
    );
    return store;
  }

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

    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: true,
      isOffline: false,
    });

    window.localStorage.clear();
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

  it('shows the sign-in prompt for guests instead of creating a local document', async () => {
    const store = renderResolver();

    expect(await screen.findByRole('button', { name: /^Sign in$/i })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(documentService.createDocument).not.toHaveBeenCalled();
    expect(documentService.getAllDocumentsMeta).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
    expect(store.getState().ui.isAuthModalOpen).toBe(true);
  });

  it('does not route guests to a leftover local document', async () => {
    (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
      { id: 'local-recent', meta: { ...defaultMeta, title: 'Old guest doc' } },
    ]);

    renderResolver();

    await screen.findByRole('button', { name: /^Sign in$/i });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(documentService.loadDocument).not.toHaveBeenCalled();
  });

  it('routes authenticated users to the latest cloud document when available', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
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

    renderResolver();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/doc/cloud-latest');
    });

    expect(documentService.createCloudDocument).not.toHaveBeenCalled();
  });

  it('retries resolution when the token changes before the first attempt settles', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    });
    (documentService.listCloudDocuments as jest.Mock).mockImplementationOnce(
      () => new Promise(() => {})
    );
    (documentService.listCloudDocuments as jest.Mock).mockResolvedValue({
      items: [{ id: 'cloud-latest', meta: defaultMeta }],
      page: 0,
      size: 1,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });

    const store = configureStore({ reducer: { ui: uiReducer } });
    const { rerender } = render(
      <Provider store={store}>
        <RootDocumentResolver />
      </Provider>
    );

    await waitFor(() =>
      expect(documentService.listCloudDocuments).toHaveBeenCalledWith('token-1', 0, 20)
    );

    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      accessToken: 'token-2',
      user: { id: 'user-1' },
    });
    rerender(
      <Provider store={store}>
        <RootDocumentResolver />
      </Provider>
    );

    await waitFor(() => {
      expect(documentService.listCloudDocuments).toHaveBeenCalledWith('token-2', 0, 20);
      expect(mockReplace).toHaveBeenCalledWith('/doc/cloud-latest');
    });
  });

  it('migrates the latest local document when the authenticated root has no cloud docs', async () => {
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
      user: { id: 'user-1' },
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

    renderResolver();

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

  it('opens a local document in place when offline instead of routing', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      accessToken: 'token-3',
      user: { id: 'user-1' },
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });
    (documentService.listCloudDocuments as jest.Mock).mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    renderResolver();

    expect(await screen.findByTestId('offline-editor')).toHaveTextContent('generated-local-id');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(getPendingCloudCreate('generated-local-id', 'user-1')).not.toBeNull();
  });
});
