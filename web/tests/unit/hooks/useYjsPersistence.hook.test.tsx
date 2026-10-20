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
  readPendingSyncEdits,
  writePendingSyncEdits,
} from '@/lib/offline-sync.util';
import { getPendingCloudCreate, queuePendingCloudCreate } from '@/lib/pending-cloud-create.util';
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
  let updateCloudIconCoverSpy: jest.SpyInstance;
  let emitLocalDocumentsChangedSpy: jest.SpyInstance;
  let getCurrentUserIdSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    window.localStorage.clear();
    getCurrentUserIdSpy = jest.spyOn(documentService, 'getCurrentUserId').mockReturnValue('user-1');
    loadDocumentSpy = jest.spyOn(documentService, 'loadDocument').mockResolvedValue(null);
    saveDocumentSpy = jest.spyOn(documentService, 'saveDocument').mockImplementation(jest.fn());
    saveCloudDocumentSpy = jest
      .spyOn(documentService, 'saveCloudDocument')
      .mockImplementation(jest.fn());
    updateCloudIconCoverSpy = jest
      .spyOn(documentService, 'updateCloudIconCover')
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
    updateCloudIconCoverSpy.mockRestore();
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
    const savePublicDocumentSpy = jest
      .spyOn(documentService, 'savePublicDocument')
      .mockResolvedValue(undefined);
    documentService.notePublicLinkDocument('link-id');

    try {
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
        expect(savePublicDocumentSpy).toHaveBeenCalled();
        expect(saveDocumentSpy).toHaveBeenCalledWith(
          'link-id',
          ydoc,
          expect.anything(),
          expect.objectContaining({ origin: 'public-link' })
        );
      });
    } finally {
      savePublicDocumentSpy.mockRestore();
    }
  });

  it('should not persist to public endpoint when accessLevel is VIEW or COMMENT', async () => {
    const savePublicDocumentSpy = jest
      .spyOn(documentService, 'savePublicDocument')
      .mockResolvedValue(undefined);
    documentService.notePublicLinkDocument('view-link-id');

    try {
      const ydoc = new Y.Doc();
      const meta: DocumentMeta = {
        title: 'View Only',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      saveDocumentSpy.mockResolvedValue(undefined);

      renderHook(() => useYjsPersistence('view-link-id', ydoc, meta, false, true, 'VIEW'), {
        wrapper,
      });

      const fragment = ydoc.getXmlFragment('blocknote');
      fragment.push([new Y.XmlElement('paragraph')]);

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      await waitFor(() => {
        expect(saveDocumentSpy).toHaveBeenCalled();
      });
      expect(savePublicDocumentSpy).not.toHaveBeenCalled();
    } finally {
      savePublicDocumentSpy.mockRestore();
    }
  });

  it('should skip the public endpoint for local-only guest docs with EDIT', async () => {
    const savePublicDocumentSpy = jest
      .spyOn(documentService, 'savePublicDocument')
      .mockResolvedValue(undefined);
    // Never noted via notePublicLinkDocument: a signed-out open of a
    // non-shared local id must stay local-only.
    try {
      const ydoc = new Y.Doc();
      const meta: DocumentMeta = {
        title: 'Local only',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      saveDocumentSpy.mockResolvedValue(undefined);

      renderHook(() => useYjsPersistence('local-only-guest-doc', ydoc, meta, false, true, 'EDIT'), {
        wrapper,
      });

      const fragment = ydoc.getXmlFragment('blocknote');
      fragment.push([new Y.XmlElement('paragraph')]);

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      await waitFor(() => {
        expect(saveDocumentSpy).toHaveBeenCalled();
      });
      expect(savePublicDocumentSpy).not.toHaveBeenCalled();
    } finally {
      savePublicDocumentSpy.mockRestore();
    }
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
        expect(saveCloudDocumentSpy).toHaveBeenCalled();
      });

      // A PATCH before the POST would 404, so the create has to land first.
      expect(createCloudDocumentSpy.mock.invocationCallOrder[0]).toBeLessThan(
        saveCloudDocumentSpy.mock.invocationCallOrder[0]
      );
      expect(getPendingCloudCreate('offline-doc')).toBeNull();
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
      expect(saveCloudDocumentSpy).not.toHaveBeenCalled();
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
        origin: 'local',
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
      saveCloudDocumentSpy.mockResolvedValue(undefined);
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
    saveCloudDocumentSpy.mockResolvedValue(undefined);

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

    // Still inside the debounce window: the burst must not have hit the cloud yet.
    expect(saveCloudDocumentSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(saveCloudDocumentSpy).toHaveBeenCalledTimes(1);
      expect(saveCloudDocumentSpy).toHaveBeenCalledWith(
        'title-doc',
        ydoc,
        expect.objectContaining({ title: 'Document' }),
        'token-1'
      );
    });
    expect(store.getState().document.meta?.title).toBe('Document');
  });

  it('should keep newer title keystrokes when an older save resolves late', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    let releaseSave: () => void = () => {};
    saveCloudDocumentSpy.mockImplementation(
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
    expect(saveCloudDocumentSpy).toHaveBeenCalledTimes(1);

    // The user keeps typing while that PATCH is still in flight.
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

    // Drain the follow-up save the last keystroke scheduled, so the unmount
    // flush does not run it against the real service.
    await act(async () => {
      saveCloudDocumentSpy.mockResolvedValue(undefined);
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
  });
});
