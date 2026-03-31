import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer from '@/stores/document/document.slice';
import { useDocument } from '@/hooks/useDocument.hook';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import { setYDoc } from '@/stores/document/ydoc-holder';
import { useAuth } from '../../../hooks/useAuth.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
    accessToken: null,
  })),
}));

describe('useDocument', () => {
  let getOrCreateDocumentSpy: jest.SpyInstance;
  let getCloudDocumentSpy: jest.SpyInstance;
  let getPublicDocumentSpy: jest.SpyInstance;
  let getMyAccessSpy: jest.SpyInstance;
  let loadDocumentSpy: jest.SpyInstance;
  let createCloudDocumentSpy: jest.SpyInstance;
  let saveCloudDocumentSpy: jest.SpyInstance;
  let updateMetadataSpy: jest.SpyInstance;
  let updateCloudMetadataSpy: jest.SpyInstance;
  let dispatchEventSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getOrCreateDocumentSpy = jest
      .spyOn(documentService, 'getOrCreateDocument')
      .mockImplementation(jest.fn());
    getCloudDocumentSpy = jest
      .spyOn(documentService, 'getCloudDocument')
      .mockImplementation(jest.fn());
    getPublicDocumentSpy = jest
      .spyOn(documentService, 'getPublicDocument')
      .mockRejectedValue(new DocumentServiceApiError('Not found', 404));
    getMyAccessSpy = jest
      .spyOn(documentService, 'getMyAccess')
      .mockImplementation(async (documentId: string) => ({
        documentId,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      }));
    loadDocumentSpy = jest.spyOn(documentService, 'loadDocument').mockResolvedValue(null);
    createCloudDocumentSpy = jest
      .spyOn(documentService, 'createCloudDocument')
      .mockImplementation(jest.fn());
    saveCloudDocumentSpy = jest
      .spyOn(documentService, 'saveCloudDocument')
      .mockImplementation(jest.fn());
    updateMetadataSpy = jest.spyOn(documentService, 'updateMetadata').mockImplementation(jest.fn());
    updateCloudMetadataSpy = jest
      .spyOn(documentService, 'updateCloudMetadata')
      .mockImplementation(jest.fn());
    dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
    });
  });

  afterEach(() => {
    getOrCreateDocumentSpy.mockRestore();
    getCloudDocumentSpy.mockRestore();
    getPublicDocumentSpy.mockRestore();
    getMyAccessSpy.mockRestore();
    loadDocumentSpy.mockRestore();
    createCloudDocumentSpy.mockRestore();
    saveCloudDocumentSpy.mockRestore();
    updateMetadataSpy.mockRestore();
    updateCloudMetadataSpy.mockRestore();
    dispatchEventSpy.mockRestore();
  });

  function createTestStore() {
    return configureStore({
      reducer: {
        document: documentReducer,
      },
    });
  }

  function createWrapper() {
    const store = createTestStore();
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    };
  }

  afterEach(() => {
    setYDoc(null);
  });

  it('should load document on mount', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.ydoc).toBe(ydoc);
    expect(result.current.meta).toEqual(meta);
    expect(result.current.error).toBeNull();
    expect(getOrCreateDocumentSpy).toHaveBeenCalledWith('test-id');
  });

  it('should use default document ID when none provided', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Default Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });

    const { result } = renderHook(() => useDocument(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getOrCreateDocumentSpy).toHaveBeenCalledWith('default-doc');
  });

  it('should load shared public document in guest mode as read-only', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Shared Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getPublicDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result } = renderHook(() => useDocument('shared-id', { isSharedDocument: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getPublicDocumentSpy).toHaveBeenCalledWith('shared-id');
    expect(getOrCreateDocumentSpy).not.toHaveBeenCalled();
    expect(result.current.accessLevel).toBe('VIEW');
    expect(result.current.isReadOnly).toBe(true);
  });

  it('should load public cloud document for guest direct doc URL when no local copy exists', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Public Shared Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    loadDocumentSpy.mockResolvedValueOnce(null);
    getPublicDocumentSpy.mockResolvedValueOnce({ ydoc, meta });

    const { result } = renderHook(() => useDocument('shared-public-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(loadDocumentSpy).toHaveBeenCalledWith('shared-public-id');
    expect(getPublicDocumentSpy).toHaveBeenCalledWith('shared-public-id');
    expect(getOrCreateDocumentSpy).not.toHaveBeenCalled();
    expect(result.current.accessLevel).toBe('VIEW');
    expect(result.current.isReadOnly).toBe(true);
  });

  it('should handle load errors', async () => {
    getOrCreateDocumentSpy.mockRejectedValue(new Error('Load failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(
      new Error('An unexpected error occurred while loading this document.')
    );
    expect(result.current.errorState).toMatchObject({
      kind: 'generic',
      title: 'Unable to open this document',
    });
    expect(result.current.meta).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  it('should update metadata', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Updated Title' });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Updated Title');
    });

    expect(updateMetadataSpy).toHaveBeenCalledWith('test-id', {
      title: 'Updated Title',
    });

    // Check if CustomEvent was dispatched
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Updated Title' }),
        }),
      })
    );
  });

  it('should load cloud document when authenticated', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result } = renderHook(() => useDocument('cloud-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getCloudDocumentSpy).toHaveBeenCalledWith('cloud-id', 'token-1');
    expect(getOrCreateDocumentSpy).not.toHaveBeenCalled();
  });

  it('should update cloud metadata when authenticated', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-2',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateCloudMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('cloud-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Cloud Updated' });
    });

    await waitFor(() => {
      expect(updateCloudMetadataSpy).toHaveBeenCalledWith(
        'cloud-id',
        { title: 'Cloud Updated' },
        'token-2'
      );
    });

    expect(updateMetadataSpy).not.toHaveBeenCalled();
  });

  it('should show restricted state when authenticated explicit document URL returns 404', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-404',
    });

    getCloudDocumentSpy.mockRejectedValueOnce(new DocumentServiceApiError('Not found', 404));

    const { result } = renderHook(() => useDocument('local-id-1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.documentId).toBe('local-id-1');
    expect(result.current.ydoc).toBeNull();
    expect(result.current.meta).toBeNull();
    expect(result.current.errorState).toMatchObject({
      kind: 'restricted',
      statusCode: 404,
    });
    expect(loadDocumentSpy).not.toHaveBeenCalled();
    expect(createCloudDocumentSpy).not.toHaveBeenCalled();
    expect(saveCloudDocumentSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should promote most recent local doc when default route has no cloud docs', async () => {
    const localYdoc = new Y.Doc();
    const localMeta = {
      title: 'Recent Local',
      createdAt: '2024-01-03T00:00:00.000Z',
      updatedAt: '2024-01-04T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-default',
    });

    const getAllLocalDocumentsSpy = jest
      .spyOn(documentService, 'getAllLocalDocuments')
      .mockResolvedValue([
        {
          id: 'local-a',
          meta: {
            title: 'Old Local',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          yjsState: new Uint8Array([1]),
          version: 1,
        },
        {
          id: 'local-b',
          meta: {
            title: 'Recent Local',
            createdAt: '2024-01-03T00:00:00.000Z',
            updatedAt: '2024-01-04T00:00:00.000Z',
          },
          yjsState: new Uint8Array([2]),
          version: 1,
        },
      ]);

    const listCloudDocumentsSpy = jest
      .spyOn(documentService, 'listCloudDocuments')
      .mockResolvedValue({
        items: [],
        page: 0,
        size: 1,
        totalElements: 0,
        totalPages: 0,
        hasMore: false,
      });

    loadDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });
    createCloudDocumentSpy.mockResolvedValue({
      id: 'cloud-from-local',
      ydoc: new Y.Doc(),
      meta: localMeta,
    });
    saveCloudDocumentSpy.mockResolvedValue(undefined);
    getCloudDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });

    const { result } = renderHook(() => useDocument(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getAllLocalDocumentsSpy).toHaveBeenCalled();
    expect(createCloudDocumentSpy).toHaveBeenCalledWith('token-default', 'Recent Local', 'local-b');
    expect(result.current.documentId).toBe('cloud-from-local');

    getAllLocalDocumentsSpy.mockRestore();
    listCloudDocumentsSpy.mockRestore();
  });

  it('should not update metadata if meta is null', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    getOrCreateDocumentSpy.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    result.current.updateMeta({ title: 'Updated' });

    expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot update meta: meta is null');
    expect(updateMetadataSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should handle metadata update errors and rollback', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    updateMetadataSpy.mockRejectedValue(new Error('Update failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Updated' });
    });

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist metadata update:',
        expect.any(Error)
      );
    });

    // Verify rollback: title should revert to original
    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Test');
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not dispatch stale responses when id changes', async () => {
    const ydoc1 = new Y.Doc();
    const meta1 = {
      title: 'Doc 1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const ydoc2 = new Y.Doc();
    const meta2 = {
      title: 'Doc 2',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    // First call hangs, second resolves immediately
    let resolveFirst: ((value: { ydoc: Y.Doc; meta: typeof meta1 }) => void) | undefined;
    const firstPromise = new Promise<{ ydoc: Y.Doc; meta: typeof meta1 }>((resolve) => {
      resolveFirst = resolve;
    });

    getOrCreateDocumentSpy
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ ydoc: ydoc2, meta: meta2 });

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { rerender } = renderHook(({ docId }: { docId: string }) => useDocument(docId), {
      wrapper: Wrapper,
      initialProps: { docId: 'doc-1' },
    });

    // Change id before first load resolves
    rerender({ docId: 'doc-2' });

    await waitFor(() => {
      expect(store.getState().document.meta?.title).toBe('Doc 2');
    });

    // Now resolve the first (stale) request
    resolveFirst?.({ ydoc: ydoc1, meta: meta1 });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // State should still show Doc 2, not Doc 1
    expect(store.getState().document.meta?.title).toBe('Doc 2');
  });

  it('should not dispatch after unmount', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    let resolveLoad: ((value: { ydoc: Y.Doc; meta: typeof meta }) => void) | undefined;
    const loadPromise = new Promise<{ ydoc: Y.Doc; meta: typeof meta }>((resolve) => {
      resolveLoad = resolve;
    });
    getOrCreateDocumentSpy.mockReturnValue(loadPromise);

    const { unmount } = renderHook(() => useDocument('test-id'), {
      wrapper: createWrapper(),
    });

    unmount();

    resolveLoad?.({ ydoc, meta });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(getOrCreateDocumentSpy).toHaveBeenCalledTimes(1);
  });

  it('should return a stable updateMeta reference across re-renders', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getOrCreateDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateMetadataSpy.mockResolvedValue(undefined);

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { result, rerender } = renderHook(({ docId }: { docId: string }) => useDocument(docId), {
      wrapper: Wrapper,
      initialProps: { docId: 'test-id' },
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstRef = result.current.updateMeta;

    // Re-render with same props — reference should be stable
    rerender({ docId: 'test-id' });

    expect(result.current.updateMeta).toBe(firstRef);
  });
});
