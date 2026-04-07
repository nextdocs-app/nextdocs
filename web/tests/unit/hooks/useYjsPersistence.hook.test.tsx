import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer from '@/stores/document/document.slice';
import type { DocumentMeta } from '@/types/document.types';
import { useYjsPersistence } from '@/hooks/useYjsPersistence.hook';
import { documentService } from '@/services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
    accessToken: null,
  })),
}));

jest.mock('../../../hooks/useNetworkStatus.hook', () => ({
  useNetworkStatus: jest.fn(() => ({
    isOnline: true,
    isOffline: false,
  })),
}));

describe('useYjsPersistence', () => {
  let loadDocumentSpy: jest.SpyInstance;
  let saveDocumentSpy: jest.SpyInstance;
  let saveCloudDocumentSpy: jest.SpyInstance;
  let emitLocalDocumentsChangedSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    window.localStorage.clear();
    loadDocumentSpy = jest.spyOn(documentService, 'loadDocument').mockResolvedValue(null);
    saveDocumentSpy = jest.spyOn(documentService, 'saveDocument').mockImplementation(jest.fn());
    saveCloudDocumentSpy = jest
      .spyOn(documentService, 'saveCloudDocument')
      .mockImplementation(jest.fn());
    emitLocalDocumentsChangedSpy = jest
      .spyOn(documentService, 'emitLocalDocumentsChanged')
      .mockImplementation(jest.fn());
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: true,
      isOffline: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    window.localStorage.clear();
    loadDocumentSpy.mockRestore();
    saveDocumentSpy.mockRestore();
    saveCloudDocumentSpy.mockRestore();
    emitLocalDocumentsChangedSpy.mockRestore();
  });

  function createTestStore() {
    return configureStore({
      reducer: {
        document: documentReducer,
      },
    });
  }

  function wrapper({ children }: { children: React.ReactNode }) {
    const store = createTestStore();
    return <Provider store={store}>{children}</Provider>;
  }

  it('should save document after debounce when ydoc updates', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    expect(saveDocumentSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'test-id',
        ydoc,
        expect.objectContaining({
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: expect.any(String),
        })
      );
    });
  });

  it('should debounce multiple rapid updates', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');

    fragment.push([new Y.XmlElement('paragraph')]);
    jest.advanceTimersByTime(100);

    fragment.push([new Y.XmlElement('paragraph')]);
    jest.advanceTimersByTime(100);

    fragment.push([new Y.XmlElement('paragraph')]);
    jest.advanceTimersByTime(100);

    expect(saveDocumentSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('should handle save errors gracefully', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockRejectedValue(new Error('Save failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to save document:', expect.any(Error));
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not save if ydoc is null', () => {
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    renderHook(() => useYjsPersistence('test-id', null, meta), { wrapper });

    jest.advanceTimersByTime(500);

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });

  it('should not save if meta is null', () => {
    const ydoc = new Y.Doc();

    renderHook(() => useYjsPersistence('test-id', ydoc, null), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    jest.advanceTimersByTime(500);

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });

  it('should cleanup event listener on unmount', () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    unmount();

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    jest.advanceTimersByTime(500);

    expect(saveDocumentSpy).not.toHaveBeenCalled();
  });

  it('should return saving state and lastSaved timestamp', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSaved).toBeNull();

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(result.current.lastSaved).not.toBeNull();
    });

    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it('should save to cloud when authenticated', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Cloud Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    saveCloudDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveCloudDocumentSpy).toHaveBeenCalledWith('cloud-id', ydoc, meta, 'token-1');
    });

    expect(saveDocumentSpy).toHaveBeenCalledWith(
      'cloud-id',
      ydoc,
      expect.objectContaining({
        title: 'Cloud Test',
      }),
      {
        touchUpdatedAt: false,
      }
    );
    expect(emitLocalDocumentsChangedSpy).not.toHaveBeenCalled();
  });

  it('should fall back to local save when cloud write fails due to connectivity', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Offline Cloud Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });
    saveCloudDocumentSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    saveDocumentSpy.mockResolvedValue(undefined);

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'cloud-id',
        ydoc,
        expect.objectContaining({
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: expect.any(String),
        })
      );
      expect(result.current.lastSaved).not.toBeNull();
    });

    expect(result.current.isSaving).toBe(false);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should track pending edits while offline', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Pending Sync Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(1);
      expect(result.current.hasPendingSync).toBe(true);
    });
  });

  it('should sync pending edits automatically when back online', async () => {
    const ydoc = new Y.Doc();
    const pendingYdoc = new Y.Doc();
    pendingYdoc.getXmlFragment('blocknote').push([new Y.XmlElement('paragraph')]);
    const meta: DocumentMeta = {
      title: 'Reconnect Sync Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const pendingMeta: DocumentMeta = {
      title: 'Reconnect Sync Test (Local Pending)',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    const networkState = {
      isOnline: false,
      isOffline: true,
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    (useNetworkStatus as jest.Mock).mockImplementation(() => networkState);
    saveDocumentSpy.mockResolvedValue(undefined);
    saveCloudDocumentSpy.mockResolvedValue(undefined);
    loadDocumentSpy.mockResolvedValue({ ydoc: pendingYdoc, meta: pendingMeta });

    const { result, rerender } = renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), {
      wrapper,
    });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(1);
    });

    networkState.isOnline = true;
    networkState.isOffline = false;
    rerender();

    await waitFor(() => {
      expect(saveCloudDocumentSpy).toHaveBeenCalledWith(
        'cloud-id',
        pendingYdoc,
        pendingMeta,
        'token-1'
      );
    });

    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(0);
      expect(result.current.hasPendingSync).toBe(false);
    });
  });
});
