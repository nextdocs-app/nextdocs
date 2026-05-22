import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer from '@/stores/document/document.slice';
import { useDocument } from '@/hooks/useDocument.hook';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import { writeCachedDocumentAccessLevel } from '@/lib/document-access.util';
import { setYDoc } from '@/stores/document/ydoc-holder';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';

const mockRefreshSession = jest.fn();

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
    accessToken: null,
    refresh: mockRefreshSession,
  })),
}));

jest.mock('../../../hooks/useNetworkStatus.hook', () => ({
  useNetworkStatus: jest.fn(() => ({
    isOnline: true,
    isOffline: false,
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
  let saveDocumentSpy: jest.SpyInstance;
  let updateMetadataSpy: jest.SpyInstance;
  let updateCloudMetadataSpy: jest.SpyInstance;
  let dispatchEventSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
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
    saveDocumentSpy = jest.spyOn(documentService, 'saveDocument').mockImplementation(jest.fn());
    updateMetadataSpy = jest.spyOn(documentService, 'updateMetadata').mockImplementation(jest.fn());
    updateCloudMetadataSpy = jest
      .spyOn(documentService, 'updateCloudMetadata')
      .mockImplementation(jest.fn());
    dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      refresh: mockRefreshSession,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: true,
      isOffline: false,
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    getOrCreateDocumentSpy.mockRestore();
    getCloudDocumentSpy.mockRestore();
    getPublicDocumentSpy.mockRestore();
    getMyAccessSpy.mockRestore();
    loadDocumentSpy.mockRestore();
    createCloudDocumentSpy.mockRestore();
    saveCloudDocumentSpy.mockRestore();
    saveDocumentSpy.mockRestore();
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
    saveDocumentSpy.mockResolvedValue(undefined);

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

    expect(updateMetadataSpy).toHaveBeenCalledWith(
      'test-id',
      expect.objectContaining({
        title: 'Updated Title',
      })
    );

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
    expect(saveDocumentSpy).toHaveBeenCalledWith('cloud-id', ydoc, meta, {
      touchUpdatedAt: false,
    });
    expect(getOrCreateDocumentSpy).not.toHaveBeenCalled();
  });

  it('should fallback to local document when authenticated cloud fetch fails due to connectivity', async () => {
    const localYdoc = new Y.Doc();
    const localMeta = {
      title: 'Local Offline Copy',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-offline',
      isInitializing: false,
    });

    getCloudDocumentSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    loadDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });
    getMyAccessSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useDocument('cloud-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(loadDocumentSpy).toHaveBeenCalledWith('cloud-id');
    expect(result.current.documentId).toBe('cloud-id');
    expect(result.current.meta?.title).toBe('Local Offline Copy');

    consoleWarnSpy.mockRestore();
  });

  it('should refresh session and fallback to cached local document when cloud fetch returns 401', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cached stale-token copy',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };
    const refresh = jest.fn();

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'stale-token',
      isInitializing: false,
      refresh,
    });

    getCloudDocumentSpy.mockRejectedValueOnce(new DocumentServiceApiError('Unauthorized', 401));
    loadDocumentSpy.mockResolvedValueOnce({ ydoc, meta });

    const { result } = renderHook(() => useDocument('cloud-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadDocumentSpy).toHaveBeenCalledWith('cloud-id');
    expect(result.current.documentId).toBe('cloud-id');
    expect(result.current.meta?.title).toBe('Cached stale-token copy');
    expect(result.current.errorState).toBeNull();
  });

  it('should keep local document state on reconnect when pending sync edits exist', async () => {
    const localYdoc = new Y.Doc();
    const localMeta = {
      title: 'Local Pending Changes',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    const networkState = {
      isOnline: false,
      isOffline: true,
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-reconnect',
      isInitializing: false,
    });
    (useNetworkStatus as jest.Mock).mockImplementation(() => networkState);

    window.localStorage.setItem('nextdocs:pending-sync:cloud-id', '2');

    loadDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });
    getCloudDocumentSpy.mockResolvedValue({
      ydoc: new Y.Doc(),
      meta: {
        title: 'Stale Server Copy',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    });

    const { result, rerender } = renderHook(() => useDocument('cloud-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.meta?.title).toBe('Local Pending Changes');

    networkState.isOnline = true;
    networkState.isOffline = false;
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(loadDocumentSpy).toHaveBeenCalledWith('cloud-id');
    expect(getCloudDocumentSpy).not.toHaveBeenCalled();
    expect(result.current.meta?.title).toBe('Local Pending Changes');
  });

  it('should not create a new untitled placeholder when authenticated offline doc is not cached', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-offline',
      isInitializing: false,
    });

    getCloudDocumentSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    loadDocumentSpy.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useDocument('cloud-missing-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.errorState?.title).toBe('Document unavailable offline');
    expect(getOrCreateDocumentSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should retry loading after document change events when migration finishes', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const recoveredYdoc = new Y.Doc();
    const recoveredMeta = {
      title: 'Recovered Cloud Copy',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-retry',
      isInitializing: false,
    });

    getCloudDocumentSpy
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ydoc: recoveredYdoc, meta: recoveredMeta });
    loadDocumentSpy.mockResolvedValue(null);

    const { result } = renderHook(() => useDocument('cloud-retry-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.errorState?.title).toBe('Document unavailable offline');
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('cloud-documents-changed'));
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Recovered Cloud Copy');
    });

    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(2);
    expect(result.current.errorState).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  it('should persist metadata locally while offline for authenticated users', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Untitled',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-offline',
      isInitializing: false,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });

    loadDocumentSpy.mockResolvedValueOnce({ ydoc, meta });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('cloud-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Renamed Offline' });
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Renamed Offline');
    });

    expect(updateMetadataSpy).toHaveBeenCalled();
    expect(updateCloudMetadataSpy).not.toHaveBeenCalled();
  });

  it('should preserve cached shared access level when authenticated offline fallback loads local copy', async () => {
    const localYdoc = new Y.Doc();
    const localMeta = {
      title: 'Shared Offline Copy',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    writeCachedDocumentAccessLevel('shared-id', 'VIEW');

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-offline',
      isInitializing: false,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });

    getCloudDocumentSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    loadDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });

    const { result } = renderHook(() => useDocument('shared-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.accessLevel).toBe('VIEW');
    expect(result.current.isReadOnly).toBe(true);
    expect(getMyAccessSpy).not.toHaveBeenCalled();

    await act(async () => {
      result.current.updateMeta({ title: 'Should Stay Read Only' });
    });

    expect(saveDocumentSpy).not.toHaveBeenCalled();
    expect(updateCloudMetadataSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
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

    expect(updateMetadataSpy).toHaveBeenCalledWith(
      'cloud-id',
      expect.objectContaining({ title: 'Cloud Updated' })
    );
  });

  it('should not reload the document when access token rotates for the same user session', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const authState = {
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    };

    (useAuth as jest.Mock).mockImplementation(() => authState);
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result, rerender } = renderHook(() => useDocument('cloud-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(1);
    expect(getCloudDocumentSpy).toHaveBeenLastCalledWith('cloud-id', 'token-1');

    authState.accessToken = 'token-2';
    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(1);
    expect(result.current.documentId).toBe('cloud-id');
    expect(result.current.meta?.title).toBe('Cloud Document');
  });

  it('should not reload the document when network status toggles after initial load', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const networkState = {
      isOnline: true,
      isOffline: false,
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-network',
      user: { id: 'user-1' },
    });
    (useNetworkStatus as jest.Mock).mockImplementation(() => networkState);
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result, rerender } = renderHook(() => useDocument('cloud-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(1);

    networkState.isOnline = false;
    networkState.isOffline = true;
    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    networkState.isOnline = true;
    networkState.isOffline = false;
    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(1);
    expect(result.current.meta?.title).toBe('Cloud Document');
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

  it('should refresh session instead of hiding the document when access revalidation returns 401', async () => {
    jest.useFakeTimers();

    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const refresh = jest.fn();

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'stale-token',
      isInitializing: false,
      refresh,
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    getMyAccessSpy
      .mockResolvedValueOnce({
        documentId: 'cloud-id',
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      })
      .mockResolvedValueOnce({
        documentId: 'cloud-id',
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      })
      .mockRejectedValueOnce(new DocumentServiceApiError('Unauthorized', 401));

    try {
      const { result } = renderHook(() => useDocument('cloud-id'), { wrapper: createWrapper() });

      await act(async () => {
        // With fake timers enabled, explicitly flush the mount-time async load chain
        // so state updates happen under React's act boundary.
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(refresh).toHaveBeenCalledTimes(1);
      });

      expect(result.current.ydoc).toBe(ydoc);
      expect(result.current.errorState).toBeNull();
      expect(result.current.accessLevel).toBe('EDIT');
    } finally {
      jest.useRealTimers();
    }
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

    // Change id before first load resolves.
    await act(async () => {
      rerender({ docId: 'doc-2' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(store.getState().document.meta?.title).toBe('Doc 2');
    });

    // Now resolve the first (stale) request.
    await act(async () => {
      resolveFirst?.({ ydoc: ydoc1, meta: meta1 });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });

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
