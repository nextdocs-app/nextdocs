import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer, {
  setCurrentDocument,
  updateMeta as updateMetaAction,
} from '@/stores/document/document.slice';
import type { DocumentMeta } from '@/types/document.types';
import { useYjsPersistence } from '@/hooks/useYjsPersistence.hook';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import {
  mergePendingIconCoverPatch,
  readPendingIconCoverPatch,
  readPendingMetaPatch,
  readPendingSyncEdits,
  writePendingMetaPatch,
  writePendingSyncEdits,
} from '@/lib/offline-sync.util';
import { getPendingCloudCreate, queuePendingCloudCreate } from '@/lib/pending-cloud-create.util';
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

describe('useYjsPersistence', () => {
  let loadDocumentSpy: jest.SpyInstance;
  let saveDocumentSpy: jest.SpyInstance;
  let updateCloudIconCoverSpy: jest.SpyInstance;
  let updateCloudMetadataSpy: jest.SpyInstance;
  let updatePublicMetadataSpy: jest.SpyInstance;
  let isPublicLinkDocumentSpy: jest.SpyInstance;
  let emitLocalDocumentsChangedSpy: jest.SpyInstance;
  let getCurrentUserIdSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    window.localStorage.clear();
    getCurrentUserIdSpy = jest.spyOn(documentService, 'getCurrentUserId').mockReturnValue('user-1');
    loadDocumentSpy = jest.spyOn(documentService, 'loadDocument').mockResolvedValue(null);
    saveDocumentSpy = jest.spyOn(documentService, 'saveDocument').mockImplementation(jest.fn());
    updateCloudIconCoverSpy = jest
      .spyOn(documentService, 'updateCloudIconCover')
      .mockImplementation(jest.fn());
    updateCloudMetadataSpy = jest
      .spyOn(documentService, 'updateCloudMetadata')
      .mockImplementation(jest.fn());
    updatePublicMetadataSpy = jest
      .spyOn(documentService, 'updatePublicMetadata')
      .mockResolvedValue(undefined);
    isPublicLinkDocumentSpy = jest
      .spyOn(documentService, 'isPublicLinkDocument')
      .mockReturnValue(false);
    emitLocalDocumentsChangedSpy = jest
      .spyOn(documentService, 'emitLocalDocumentsChanged')
      .mockImplementation(jest.fn());
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
    jest.useRealTimers();
    window.localStorage.clear();
    loadDocumentSpy.mockRestore();
    saveDocumentSpy.mockRestore();
    updateCloudIconCoverSpy.mockRestore();
    updateCloudMetadataSpy.mockRestore();
    updatePublicMetadataSpy.mockRestore();
    isPublicLinkDocumentSpy.mockRestore();
    emitLocalDocumentsChangedSpy.mockRestore();
    getCurrentUserIdSpy.mockRestore();
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

  // Title edits change the store's meta on every keystroke; these tests need the
  // store they assert on, so they build the provider around a fixed store.
  function createControlledStore(meta: DocumentMeta) {
    const store = createTestStore();
    store.dispatch(setCurrentDocument({ id: 'title-doc', meta }));
    return {
      store,
      controlledWrapper: ({ children }: { children: React.ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    };
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
        }),
        undefined
      );
    });
  });

  it('flushes a pending debounced save on unmount instead of dropping it', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Unsaved edits',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useYjsPersistence('test-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    expect(saveDocumentSpy).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'test-id',
        ydoc,
        expect.objectContaining({ title: meta.title }),
        undefined
      );
    });
  });

  it('should tag the local mirror as public-link when saving a share-link session', async () => {
    // The suite stubs the lookup, so flag the document here rather than registering
    // a real share-link session that `isPublicLinkDocument` would never consult.
    isPublicLinkDocumentSpy.mockReturnValue(true);

    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Linked',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('link-id', ydoc, meta, false, true, 'EDIT'), {
      wrapper,
    });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'link-id',
        ydoc,
        expect.anything(),
        expect.objectContaining({ origin: 'public-link' })
      );
    });
  });

  it('creates the queued cloud document before saving edits to it', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Born offline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    saveDocumentSpy.mockResolvedValue(undefined);
    loadDocumentSpy.mockResolvedValue({ ydoc, meta });
    const createCloudDocumentSpy = jest
      .spyOn(documentService, 'createCloudDocument')
      .mockResolvedValue({ id: 'offline-doc', ydoc, meta });
    const emitCloudDocumentsChangedSpy = jest
      .spyOn(documentService, 'emitCloudDocumentsChanged')
      .mockImplementation(() => {});
    queuePendingCloudCreate({ id: 'offline-doc', userId: 'user-1', parentId: null });

    try {
      renderHook(() => useYjsPersistence('offline-doc', ydoc, meta), { wrapper });

      const fragment = ydoc.getXmlFragment('blocknote');
      fragment.push([new Y.XmlElement('paragraph')]);

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      await waitFor(() => {
        expect(createCloudDocumentSpy).toHaveBeenCalled();
        expect(getPendingCloudCreate('offline-doc')).toBeNull();
      });
    } finally {
      createCloudDocumentSpy.mockRestore();
      emitCloudDocumentsChangedSpy.mockRestore();
    }
  });

  it('discards a rejected pending create instead of pinning its edits offline', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Rejected offline draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    });
    loadDocumentSpy.mockResolvedValue({ ydoc, meta });
    const deleteDocumentSpy = jest
      .spyOn(documentService, 'deleteDocument')
      .mockResolvedValue(undefined);
    const createCloudDocumentSpy = jest
      .spyOn(documentService, 'createCloudDocument')
      .mockRejectedValue(new DocumentServiceApiError('Forbidden', 403));
    queuePendingCloudCreate({ id: 'offline-doc', userId: 'user-1', parentId: null });
    writePendingSyncEdits('offline-doc', 1);

    try {
      renderHook(() => useYjsPersistence('offline-doc', ydoc, meta), { wrapper });

      await waitFor(() => expect(deleteDocumentSpy).toHaveBeenCalledWith('offline-doc'));

      expect(getPendingCloudCreate('offline-doc')).toBeNull();
      expect(readPendingSyncEdits('offline-doc')).toBe(0);
    } finally {
      deleteDocumentSpy.mockRestore();
      createCloudDocumentSpy.mockRestore();
    }
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

  it('should save document locally after debounce when authenticated', async () => {
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
    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), { wrapper });

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
          title: 'Cloud Test',
        }),
        undefined
      );
    });
  });

  it('persists the pending debounce locally when the page is hidden', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Backgrounded',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), { wrapper });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    expect(saveDocumentSpy).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(saveDocumentSpy).toHaveBeenCalledWith(
          'cloud-id',
          ydoc,
          expect.objectContaining({ title: 'Backgrounded' }),
          undefined
        );
      });

      // The marker is what makes the next load prefer these bytes; the cloud
      // PATCH is deliberately left to the visible/flush path.
      expect(readPendingSyncEdits('cloud-id')).toBe(1);
    } finally {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  });

  it('keeps the edit queued when offline', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Offline Queue Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
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
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'cloud-id',
        ydoc,
        expect.objectContaining({ title: 'Offline Queue Test' }),
        undefined
      );
      expect(result.current.pendingEdits).toBe(1);
    });

    expect(result.current.isSaving).toBe(false);
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
        }),
        undefined
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

  it('keeps an offline edit until a realtime sync delivers it, then clears the marker', async () => {
    const ydoc = new Y.Doc();
    // Stands in for Yhub: a provider forwards this document's updates to it.
    const receivingYdoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Reconnect Sync Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    let synced = false;

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true, isOffline: false });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      () => useYjsPersistence('cloud-id', ydoc, meta, false, true, 'EDIT', synced),
      { wrapper }
    );

    // The provider cannot deliver while the socket is down. Buffer exactly what it
    // would send, then flush that buffer before it reports `synced`: that ordering
    // is what makes a cleared marker mean "delivered", not merely "reconnected".
    const undelivered: Uint8Array[] = [];
    ydoc.on('update', (update: Uint8Array) => {
      if (synced) {
        Y.applyUpdate(receivingYdoc, update);
      } else {
        undelivered.push(update);
      }
    });

    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    // Online, but without a socket handshake the local save is not an acknowledgement.
    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(1);
      expect(result.current.hasPendingSync).toBe(true);
    });

    // Nothing reached the receiving document while the socket was down.
    expect(receivingYdoc.getXmlFragment('blocknote').length).toBe(0);

    undelivered.forEach((update) => Y.applyUpdate(receivingYdoc, update));
    synced = true;
    rerender();

    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(0);
      expect(result.current.hasPendingSync).toBe(false);
    });

    // The provider delivered the offline edit to the receiving document; that
    // delivery is what the cleared marker was asserting.
    expect(receivingYdoc.getXmlFragment('blocknote').length).toBe(1);
  });

  it('replays a queued title through REST before clearing its marker', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Old Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true, isOffline: false });
    saveDocumentSpy.mockResolvedValue(undefined);
    writePendingMetaPatch('user-1', 'title-queued', { title: 'Renamed offline' });
    writePendingSyncEdits('title-queued', 1);

    const { result } = renderHook(() => useYjsPersistence('title-queued', ydoc, meta), {
      wrapper,
    });

    await waitFor(() => {
      expect(updateCloudMetadataSpy).toHaveBeenCalledWith(
        'title-queued',
        { title: 'Renamed offline' },
        'token-1'
      );
    });
    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(0);
    });
    expect(readPendingMetaPatch('user-1', 'title-queued')).toBeNull();
  });

  it('keeps a rate-limited queued title and its marker for retry', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Original',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true, isOffline: false });
    saveDocumentSpy.mockResolvedValue(undefined);
    updateCloudMetadataSpy.mockRejectedValue(new DocumentServiceApiError('Too many requests', 429));
    writePendingMetaPatch('user-1', 'rate-limited', { title: 'Retry me' });
    writePendingSyncEdits('rate-limited', 1);

    const { result } = renderHook(() => useYjsPersistence('rate-limited', ydoc, meta), {
      wrapper,
    });

    await waitFor(() => {
      expect(updateCloudMetadataSpy).toHaveBeenCalled();
    });

    // 429 is backpressure, not a verdict: the title is still the only durable copy.
    expect(readPendingMetaPatch('user-1', 'rate-limited')).toEqual({ title: 'Retry me' });
    expect(result.current.pendingEdits).toBe(1);
  });

  it('acknowledges a replayed title even when the icon replay fails', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: true, isOffline: false });
    saveDocumentSpy.mockResolvedValue(undefined);
    updateCloudMetadataSpy.mockResolvedValue(undefined);
    updateCloudIconCoverSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    writePendingMetaPatch('user-1', 'partial-ack', { title: 'Landed' });
    mergePendingIconCoverPatch('partial-ack', { icon: { type: 'emoji', value: '📝' } });
    writePendingSyncEdits('partial-ack', 2);

    const { result } = renderHook(
      () => useYjsPersistence('partial-ack', ydoc, meta, false, true, 'EDIT', true),
      { wrapper }
    );

    await waitFor(() => {
      expect(updateCloudMetadataSpy).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(1);
    });
    // The title landed and its marker is receipted; only the icon stays queued.
    expect(readPendingMetaPatch('user-1', 'partial-ack')).toBeNull();
    expect(readPendingIconCoverPatch('partial-ack')).toEqual({
      icon: { type: 'emoji', value: '📝' },
    });
  });

  it('replays a queued guest title through the public metadata endpoint', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Shared',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      refresh: mockRefreshSession,
    });
    isPublicLinkDocumentSpy.mockReturnValue(true);
    writePendingMetaPatch('public', 'guest-title', { title: 'Guest rename' });
    writePendingSyncEdits('guest-title', 1);

    const { result } = renderHook(() => useYjsPersistence('guest-title', ydoc, meta), {
      wrapper,
    });

    await waitFor(() => {
      expect(updatePublicMetadataSpy).toHaveBeenCalledWith('guest-title', {
        title: 'Guest rename',
      });
    });
    await waitFor(() => {
      expect(result.current.pendingEdits).toBe(0);
    });
    expect(readPendingMetaPatch('public', 'guest-title')).toBeNull();
  });

  it('does not consume a content marker another tab queued', async () => {
    const ydoc = new Y.Doc();
    const meta: DocumentMeta = {
      title: 'Shared device',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      user: { id: 'user-1' },
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { rerender } = renderHook(
      (props: { synced: boolean }) =>
        useYjsPersistence('shared-markers', ydoc, meta, false, true, 'EDIT', props.synced),
      { wrapper, initialProps: { synced: false } }
    );

    // Another tab on this device queues an edit this tab never made. Its content is
    // not in this tab's copy, so this tab's sync cannot prove it was delivered.
    act(() => {
      writePendingSyncEdits('shared-markers', 1);
    });

    rerender({ synced: true });

    await waitFor(() => {
      expect(readPendingSyncEdits('shared-markers')).toBe(1);
    });
  });

  // A cleared icon is absent from the queued meta and the content save omits that
  // key, which the API reads as "leave unchanged". The queued patch is what makes
  // an offline Remove survive the reconnect.
  describe('queued icon/cover patch', () => {
    const clearIcon = { type: null, value: null };

    function setupQueuedPatch() {
      const ydoc = new Y.Doc();
      const meta: DocumentMeta = {
        title: 'Icon Replay Test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      const networkState = { isOnline: false, isOffline: true };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-1',
      });
      (useNetworkStatus as jest.Mock).mockImplementation(() => networkState);
      saveDocumentSpy.mockResolvedValue(undefined);
      loadDocumentSpy.mockResolvedValue({ ydoc, meta });

      window.localStorage.setItem('nextdocs:pending-sync:cloud-id', '1');
      mergePendingIconCoverPatch('cloud-id', { icon: clearIcon });

      const { result, rerender } = renderHook(() => useYjsPersistence('cloud-id', ydoc, meta), {
        wrapper,
      });

      const goOnline = () => {
        networkState.isOnline = true;
        networkState.isOffline = false;
        rerender();
      };

      return { result, goOnline };
    }

    it('replays the patch through the endpoint that can express a clear', async () => {
      updateCloudIconCoverSpy.mockResolvedValue(undefined);

      const { result, goOnline } = setupQueuedPatch();

      // Offline there is no durable write to attempt yet.
      expect(updateCloudIconCoverSpy).not.toHaveBeenCalled();

      goOnline();

      await waitFor(() => {
        expect(updateCloudIconCoverSpy).toHaveBeenCalledWith(
          'cloud-id',
          { icon: clearIcon },
          'token-1'
        );
      });

      await waitFor(() => {
        expect(readPendingIconCoverPatch('cloud-id')).toBeNull();
        expect(result.current.pendingEdits).toBe(0);
      });
    });

    it('keeps the patch queued when the replay cannot reach the server', async () => {
      updateCloudIconCoverSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      const { result, goOnline } = setupQueuedPatch();

      goOnline();

      await waitFor(() => {
        expect(updateCloudIconCoverSpy).toHaveBeenCalledTimes(1);
      });

      // Still queued for the next reconnect, and the counter still marks the
      // document as having unsynced work.
      expect(readPendingIconCoverPatch('cloud-id')).toEqual({ icon: clearIcon });
      expect(result.current.pendingEdits).toBeGreaterThan(0);
    });

    it('keeps a marker created while the icon replay was in flight', async () => {
      let releasePatch: () => void = () => {};
      updateCloudIconCoverSpy.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releasePatch = resolve;
          })
      );

      const { result, goOnline } = setupQueuedPatch();

      goOnline();

      await waitFor(() => {
        expect(updateCloudIconCoverSpy).toHaveBeenCalledTimes(1);
      });

      // A new edit lands while the PATCH is still in flight.
      act(() => {
        writePendingSyncEdits('cloud-id', 2);
      });

      releasePatch();

      await waitFor(() => {
        expect(readPendingIconCoverPatch('cloud-id')).toBeNull();
      });
      // Only the marker this flush replayed is acknowledged.
      await waitFor(() => {
        expect(result.current.pendingEdits).toBe(1);
      });
    });

    it('drops a patch the server refuses instead of pinning the document local', async () => {
      updateCloudIconCoverSpy.mockRejectedValue(new DocumentServiceApiError('Forbidden', 403));

      const { result, goOnline } = setupQueuedPatch();

      goOnline();

      // A queued patch forces local-only reads, so a write the server will keep
      // refusing has to be dropped rather than retried forever.
      await waitFor(() => {
        expect(readPendingIconCoverPatch('cloud-id')).toBeNull();
      });
      await waitFor(() => {
        expect(result.current.pendingEdits).toBe(0);
      });
    });
  });

  it('should debounce title keystrokes into one save carrying the whole title', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const base: DocumentMeta = {
      title: 'Untitled',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const ydoc = new Y.Doc();
    const { store, controlledWrapper } = createControlledStore(base);

    const { rerender } = renderHook(
      (props: { meta: DocumentMeta }) =>
        useYjsPersistence('title-doc', ydoc, props.meta, false, true, 'OWNER'),
      { wrapper: controlledWrapper, initialProps: { meta: base } }
    );

    // Each keystroke commits the new title to the store and mirrors it into the
    // shared title map, exactly like useDocument.updateMeta does.
    for (const title of ['Doc', 'Docu', 'Document']) {
      const nextMeta: DocumentMeta = { ...base, title };
      act(() => {
        store.dispatch(updateMetaAction({ title, updatedAt: nextMeta.updatedAt }));
        ydoc.getMap('meta').set('title', title);
        rerender({ meta: nextMeta });
      });
    }

    // Still inside the debounce window: the burst must not have persisted yet.
    expect(saveDocumentSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveDocumentSpy).toHaveBeenCalled();
      expect(saveDocumentSpy).toHaveBeenCalledWith(
        'title-doc',
        ydoc,
        expect.objectContaining({ title: 'Document' }),
        undefined
      );
    });
    expect(store.getState().document.meta?.title).toBe('Document');
  });

  it('should keep newer title keystrokes when an older save resolves late', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });

    let releaseSave: () => void = () => {};
    saveDocumentSpy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        })
    );

    const base: DocumentMeta = {
      title: 'Meeting',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const ydoc = new Y.Doc();
    const { store, controlledWrapper } = createControlledStore(base);

    const { rerender } = renderHook(
      (props: { meta: DocumentMeta }) =>
        useYjsPersistence('title-doc', ydoc, props.meta, false, true, 'OWNER'),
      { wrapper: controlledWrapper, initialProps: { meta: base } }
    );

    act(() => {
      ydoc.getMap('meta').set('title', base.title);
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(saveDocumentSpy).toHaveBeenCalled();

    // The user keeps typing while that save is still in flight.
    const typedMeta: DocumentMeta = { ...base, title: 'Meeting Notes' };
    act(() => {
      store.dispatch(updateMetaAction({ title: typedMeta.title, updatedAt: typedMeta.updatedAt }));
      ydoc.getMap('meta').set('title', typedMeta.title);
      rerender({ meta: typedMeta });
    });

    await act(async () => {
      releaseSave();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The save's snapshot must not roll the editor back to "Meeting".
    expect(store.getState().document.meta?.title).toBe('Meeting Notes');

    // Drain the follow-up save the last keystroke scheduled.
    await act(async () => {
      saveDocumentSpy.mockResolvedValue(undefined);
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
  });
});
