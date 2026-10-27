import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as Y from 'yjs';
import documentReducer from '@/stores/document/document.slice';
import { useDocument } from '@/hooks/useDocument.hook';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import {
  readCachedDocumentAccessLevel,
  writeCachedDocumentAccessLevel,
} from '@/lib/document-access.util';
import { readPendingIconCoverPatch, readPendingSyncEdits } from '@/lib/offline-sync.util';
import { setYDoc } from '@/stores/document/ydoc-holder';
import { queuePendingCloudCreate, removePendingCloudCreate } from '@/lib/pending-cloud-create.util';
import { WebsocketProvider } from 'y-websocket';
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

const mockOn = jest.fn();
const mockOff = jest.fn();
const mockDestroy = jest.fn();
const mockConnect = jest.fn();
const mockSetLocalStateField = jest.fn();

type ProviderEventHandler = (event: { status: string } | { code: number }) => void;

let registeredStatusHandler: ProviderEventHandler | null = null;
let registeredCloseHandler: ProviderEventHandler | null = null;

mockOn.mockImplementation((event: string, handler: ProviderEventHandler) => {
  if (event === 'status') {
    registeredStatusHandler = handler;
  } else if (event === 'connection-close') {
    registeredCloseHandler = handler;
  }
});

const mockProviderInstance = {
  on: mockOn,
  off: mockOff,
  destroy: mockDestroy,
  connect: mockConnect,
  shouldConnect: true,
  awareness: {
    setLocalStateField: mockSetLocalStateField,
  },
};

jest.mock('y-websocket', () => ({
  WebsocketProvider: jest.fn().mockImplementation(() => mockProviderInstance),
}));

describe('useDocument', () => {
  let getCloudDocumentSpy: jest.SpyInstance;
  let getPublicDocumentSpy: jest.SpyInstance;
  let getMyAccessSpy: jest.SpyInstance;
  let loadDocumentSpy: jest.SpyInstance;
  let createCloudDocumentSpy: jest.SpyInstance;
  let saveCloudDocumentSpy: jest.SpyInstance;
  let saveDocumentSpy: jest.SpyInstance;
  let updateMetadataSpy: jest.SpyInstance;
  let updateCloudMetadataSpy: jest.SpyInstance;
  let updatePublicMetadataSpy: jest.SpyInstance;
  let updateCloudIconCoverSpy: jest.SpyInstance;
  let updatePublicIconCoverSpy: jest.SpyInstance;
  let restoreCloudDocumentFromTrashSpy: jest.SpyInstance;
  let dispatchEventSpy: jest.SpyInstance;
  let checkAccessSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
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
    updatePublicMetadataSpy = jest
      .spyOn(documentService, 'updatePublicMetadata')
      .mockImplementation(jest.fn());
    updateCloudIconCoverSpy = jest
      .spyOn(documentService, 'updateCloudIconCover')
      .mockImplementation(jest.fn());
    updatePublicIconCoverSpy = jest
      .spyOn(documentService, 'updatePublicIconCover')
      .mockImplementation(jest.fn());
    restoreCloudDocumentFromTrashSpy = jest
      .spyOn(documentService, 'restoreCloudDocumentFromTrash')
      .mockImplementation(jest.fn());
    dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');
    checkAccessSpy = jest
      .spyOn(documentService, 'checkAccess')
      .mockRejectedValue(new Error('the guest path should not need an access check'));
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-1',
      isInitializing: false,
      user: { id: 'user-1' },
      refresh: mockRefreshSession,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: true,
      isOffline: false,
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    getCloudDocumentSpy.mockRestore();
    getPublicDocumentSpy.mockRestore();
    getMyAccessSpy.mockRestore();
    loadDocumentSpy.mockRestore();
    createCloudDocumentSpy.mockRestore();
    saveCloudDocumentSpy.mockRestore();
    saveDocumentSpy.mockRestore();
    updateMetadataSpy.mockRestore();
    updateCloudMetadataSpy.mockRestore();
    updatePublicMetadataSpy.mockRestore();
    updateCloudIconCoverSpy.mockRestore();
    updatePublicIconCoverSpy.mockRestore();
    restoreCloudDocumentFromTrashSpy.mockRestore();
    dispatchEventSpy.mockRestore();
    checkAccessSpy.mockRestore();
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

  /** Share-link tests run without an account; private docs need one now. */
  function useGuestAuth() {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      isInitializing: false,
      refresh: mockRefreshSession,
    });
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

    getCloudDocumentSpy.mockResolvedValue({
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
    expect(getCloudDocumentSpy).toHaveBeenCalledWith('test-id', 'token-1', {
      includeTrashed: true,
    });
    // A document this device owns is not someone else's share link.
    expect(result.current.isGuestShareLink).toBe(false);
  });

  it('should load shared public document in guest mode as read-only', async () => {
    useGuestAuth();
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
    expect(getCloudDocumentSpy).not.toHaveBeenCalled();
    expect(result.current.accessLevel).toBe('VIEW');
    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.isGuestShareLink).toBe(true);
  });

  it('takes the guest access level from the public payload without a second access check', async () => {
    useGuestAuth();
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Comment-only Share',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    // The share link grants comments: enough to read, not to write.
    getPublicDocumentSpy.mockResolvedValue({ ydoc, meta, accessLevel: 'COMMENT' });

    const { result } = renderHook(
      () => useDocument('shared-comment-id', { isSharedDocument: true }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.accessLevel).toBe('COMMENT');
    expect(result.current.isReadOnly).toBe(true);
    // checkAccess is mocked to fail, so a COMMENT level here can only have come from the
    // payload - and it is the level kept for an offline reopen.
    expect(readCachedDocumentAccessLevel('shared-comment-id')).toBe('COMMENT');
  });

  it('lets a guest write when the share link payload grants edit', async () => {
    useGuestAuth();
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Editable Share',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getPublicDocumentSpy.mockResolvedValue({ ydoc, meta, accessLevel: 'EDIT' });

    const { result } = renderHook(() => useDocument('shared-edit-id', { isSharedDocument: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.accessLevel).toBe('EDIT');
    expect(result.current.isReadOnly).toBe(false);
    // Same again: the failing access check cannot be what made this guest a writer.
    expect(readCachedDocumentAccessLevel('shared-edit-id')).toBe('EDIT');
    // A writer on someone else's link is still a guest, which the notice needs to know.
    expect(result.current.isGuestShareLink).toBe(true);
  });

  it('should load public cloud document for guest direct doc URL when no local copy exists', async () => {
    useGuestAuth();
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
    expect(getCloudDocumentSpy).not.toHaveBeenCalled();
    expect(result.current.accessLevel).toBe('VIEW');
    expect(result.current.isReadOnly).toBe(true);
  });

  it('should revalidate a cached share-link mirror instead of trusting it as local', async () => {
    useGuestAuth();
    const staleYdoc = new Y.Doc();
    const staleMeta = {
      title: 'Stale Mirror',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const freshYdoc = new Y.Doc();
    const freshMeta = {
      title: 'Live Public Doc',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    loadDocumentSpy.mockResolvedValueOnce({
      ydoc: staleYdoc,
      meta: staleMeta,
      origin: 'public-link',
    });
    getPublicDocumentSpy.mockResolvedValueOnce({ ydoc: freshYdoc, meta: freshMeta });

    const { result } = renderHook(() => useDocument('mirror-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getPublicDocumentSpy).toHaveBeenCalledWith('mirror-id');
    expect(result.current.ydoc).toBe(freshYdoc);
    expect(result.current.meta).toEqual(freshMeta);
  });

  it('should not invent a writable blank doc for a known share link opened offline', async () => {
    useGuestAuth();
    const isPublicLinkSpy = jest
      .spyOn(documentService, 'isPublicLinkDocument')
      .mockReturnValue(true);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (useNetworkStatus as jest.Mock).mockReturnValue({ isOnline: false, isOffline: true });
    loadDocumentSpy.mockResolvedValueOnce(null);
    getPublicDocumentSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useDocument('known-link-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getCloudDocumentSpy).not.toHaveBeenCalled();
    expect(result.current.meta).toBeNull();
    expect(result.current.errorState).toMatchObject({ title: 'Document unavailable offline' });

    isPublicLinkSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should handle load errors', async () => {
    getCloudDocumentSpy.mockRejectedValue(new Error('Load failed'));

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

    getCloudDocumentSpy.mockResolvedValue({
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

  it('should emit document-meta-updated on load so a stale sidebar reconciles', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Fresh Title From Elsewhere',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Fresh Title From Elsewhere' }),
        }),
      })
    );
  });

  it('should mirror local title edits into the shared Yjs meta map', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
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

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Updated Title');
    });

    expect(ydoc.getMap('meta').get('title')).toBe('Updated Title');
  });

  it('should not fan out a second title event for its own Yjs echo', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    dispatchEventSpy.mockClear();

    await act(async () => {
      result.current.updateMeta({ title: 'Typed Title' });
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Typed Title');
    });

    // The map write runs synchronously inside updateMeta, so the observer sees
    // the echo before metaRef commits; only the local edit's own event belongs here.
    const titleEvents = dispatchEventSpy.mock.calls.filter(
      ([event]) => (event as Event).type === 'document-meta-updated'
    );
    expect(titleEvents).toHaveLength(1);
  });

  it('should apply remote Yjs title updates to the editor without re-persisting REST', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    dispatchEventSpy.mockClear();
    updateCloudMetadataSpy.mockClear();
    updateMetadataSpy.mockClear();

    await act(async () => {
      ydoc.getMap('meta').set('title', 'Remote Title');
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Remote Title');
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Remote Title' }),
        }),
      })
    );
    expect(updateCloudMetadataSpy).not.toHaveBeenCalled();
    expect(updateMetadataSpy).not.toHaveBeenCalled();
  });

  it('should normalize a blank remote Yjs title to Untitled', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      ydoc.getMap('meta').set('title', '   ');
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Untitled');
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Untitled' }),
        }),
      })
    );
  });

  it('should mirror local icon edits into the shared Yjs meta map', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const nextIcon = { type: 'emoji', value: '🎉' } as const;

    await act(async () => {
      result.current.updateIcon(nextIcon);
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toEqual(nextIcon);
    });

    expect(ydoc.getMap('meta').get('icon')).toBe(JSON.stringify(nextIcon));
  });

  it('should mirror local cover edits and removals into the shared Yjs meta map', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const nextCover = {
      type: 'link',
      value: 'https://cdn.example/cover.jpg',
      position: 0.5,
    } as const;

    await act(async () => {
      result.current.updateCover(nextCover);
    });

    await waitFor(() => {
      expect(result.current.meta?.cover).toEqual(nextCover);
    });

    expect(ydoc.getMap('meta').get('cover')).toBe(JSON.stringify(nextCover));

    await act(async () => {
      result.current.updateCover(null);
    });

    await waitFor(() => {
      expect(result.current.meta?.cover).toBeUndefined();
    });

    expect(ydoc.getMap('meta').has('cover')).toBe(false);
  });

  it('should not fan out a second icon event for its own Yjs echo', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    dispatchEventSpy.mockClear();

    await act(async () => {
      result.current.updateIcon({ type: 'emoji', value: '🎉' });
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toEqual({ type: 'emoji', value: '🎉' });
    });

    // The map write runs synchronously inside commitIconCover, so the observer
    // sees the echo before metaRef commits; only the local edit's own event belongs here.
    const metaEvents = dispatchEventSpy.mock.calls.filter(
      ([event]) => (event as Event).type === 'document-meta-updated'
    );
    expect(metaEvents).toHaveLength(1);
  });

  it('should apply remote Yjs icon and cover updates without re-persisting REST', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    dispatchEventSpy.mockClear();
    updateCloudMetadataSpy.mockClear();
    updateMetadataSpy.mockClear();

    const remoteIcon = { type: 'emoji', value: '🚀' };
    const remoteCover = {
      type: 'link',
      value: 'https://cdn.example/remote.jpg',
      position: 0.3,
    };

    await act(async () => {
      ydoc.getMap('meta').set('icon', JSON.stringify(remoteIcon));
      ydoc.getMap('meta').set('cover', JSON.stringify(remoteCover));
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toEqual(remoteIcon);
    });

    await waitFor(() => {
      expect(result.current.meta?.cover).toEqual(remoteCover);
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ icon: remoteIcon, cover: remoteCover }),
        }),
      })
    );
    expect(updateCloudMetadataSpy).not.toHaveBeenCalled();
    expect(updateMetadataSpy).not.toHaveBeenCalled();
  });

  it('should apply a remote Yjs icon removal to the editor', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      icon: { type: 'emoji', value: '🎉' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The seeder mirrors the loaded icon so late joiners see it live.
    await waitFor(() => {
      expect(ydoc.getMap('meta').get('icon')).toBe(JSON.stringify(meta.icon));
    });

    dispatchEventSpy.mockClear();
    updateMetadataSpy.mockClear();

    await act(async () => {
      ydoc.getMap('meta').delete('icon');
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toBeUndefined();
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Original Title' }),
        }),
      })
    );
    expect(updateMetadataSpy).not.toHaveBeenCalled();
  });

  it('should apply a remote Yjs cover removal to the editor', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      cover: { type: 'link', value: 'https://example.com/c.jpg', position: 0.3 },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The seeder mirrors the loaded cover so late joiners see it live.
    await waitFor(() => {
      expect(ydoc.getMap('meta').get('cover')).toBe(JSON.stringify(meta.cover));
    });

    dispatchEventSpy.mockClear();
    updateMetadataSpy.mockClear();

    await act(async () => {
      ydoc.getMap('meta').delete('cover');
    });

    await waitFor(() => {
      expect(result.current.meta?.cover).toBeUndefined();
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-meta-updated',
        detail: expect.objectContaining({
          id: 'test-id',
          meta: expect.objectContaining({ title: 'Original Title' }),
        }),
      })
    );
    expect(updateMetadataSpy).not.toHaveBeenCalled();
  });

  it('should ignore invalid remote Yjs icon and cover payloads', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Original Title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({
      ydoc,
      meta,
    });
    saveDocumentSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    dispatchEventSpy.mockClear();

    await act(async () => {
      ydoc.getMap('meta').set('icon', 'not-json');
      ydoc
        .getMap('meta')
        .set('cover', JSON.stringify({ type: 'link', value: 'http://insecure/x.jpg' }));
    });

    // Let any observer-driven dispatch flush; neither payload may apply.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.meta?.icon).toBeUndefined();
    expect(result.current.meta?.cover).toBeUndefined();
    const metaEvents = dispatchEventSpy.mock.calls.filter(
      ([event]) => (event as Event).type === 'document-meta-updated'
    );
    expect(metaEvents).toHaveLength(0);
  });

  it('should persist updateIcon through updateCloudIconCover and mirror into IndexedDB', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-icon',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateCloudIconCoverSpy.mockResolvedValue(undefined);
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('icon-cloud-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const nextIcon = { type: 'emoji', value: '🚀' } as const;

    await act(async () => {
      result.current.updateIcon(nextIcon);
    });

    await waitFor(() => {
      expect(updateCloudIconCoverSpy).toHaveBeenCalledWith(
        'icon-cloud-id',
        { icon: { type: 'emoji', value: '🚀' } },
        'token-icon'
      );
    });

    // The durable cloud write is mirrored into the local IndexedDB cache.
    await waitFor(() => {
      expect(updateMetadataSpy).toHaveBeenCalledWith(
        'icon-cloud-id',
        expect.objectContaining({ icon: nextIcon })
      );
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toEqual(nextIcon);
    });
  });

  it('should send an explicit null-clear payload for updateCover(null)', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      cover: { type: 'link', value: 'https://cdn.example/old.jpg', position: 0.2 },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-cover',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateCloudIconCoverSpy.mockResolvedValue(undefined);
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('cover-cloud-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateCover(null);
    });

    // Clearing needs an explicit null payload; an absent key would mean
    // "leave unchanged" on the icon/cover endpoint.
    await waitFor(() => {
      expect(updateCloudIconCoverSpy).toHaveBeenCalledWith(
        'cover-cloud-id',
        { cover: { type: null, value: null, position: null } },
        'token-cover'
      );
    });

    await waitFor(() => {
      expect(result.current.meta?.cover).toBeUndefined();
    });

    expect(ydoc.getMap('meta').has('cover')).toBe(false);
  });

  it('should persist updateIcon through updatePublicIconCover for an edit-level guest', async () => {
    useGuestAuth();
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Editable Share',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getPublicDocumentSpy.mockResolvedValue({ ydoc, meta, accessLevel: 'EDIT' });
    updatePublicIconCoverSpy.mockResolvedValue(undefined);
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('shared-icon-id', { isSharedDocument: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateIcon({ type: 'emoji', value: '🎉' });
    });

    await waitFor(() => {
      expect(updatePublicIconCoverSpy).toHaveBeenCalledWith('shared-icon-id', {
        icon: { type: 'emoji', value: '🎉' },
      });
    });

    expect(updateCloudIconCoverSpy).not.toHaveBeenCalled();
  });

  it('should roll back the icon when the durable write rejects and no newer write exists', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-rollback',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateCloudIconCoverSpy.mockRejectedValue(new Error('durable boom'));
    updateMetadataSpy.mockResolvedValue(undefined);

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { result } = renderHook(() => useDocument('rollback-id'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        result.current.updateIcon({ type: 'emoji', value: '🚀' });
      });

      await waitFor(() => {
        expect(result.current.meta?.icon).toBeUndefined();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist page icon/cover update:',
        expect.any(Error)
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('should not roll back a newer icon when an older icon write fails', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-race',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateMetadataSpy.mockResolvedValue(undefined);

    let rejectFirst!: (reason?: unknown) => void;
    const firstWrite = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    firstWrite.catch(() => {});
    updateCloudIconCoverSpy.mockReturnValueOnce(firstWrite).mockResolvedValueOnce(undefined);

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { result } = renderHook(() => useDocument('icon-race-id'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        result.current.updateIcon({ type: 'emoji', value: '🥇' });
      });

      await act(async () => {
        result.current.updateIcon({ type: 'emoji', value: '🥈' });
      });

      await act(async () => {
        rejectFirst(new Error('stale icon failure'));
        await firstWrite.catch(() => {});
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => {
        expect(result.current.meta?.icon).toEqual({ type: 'emoji', value: '🥈' });
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('should persist icon locally and queue pending sync while offline', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
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
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('icon-offline-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateIcon({ type: 'emoji', value: '📴' });
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toEqual({ type: 'emoji', value: '📴' });
    });

    // Offline there is no durable remote write to attempt; the edit lands in
    // IndexedDB and is queued for a later sync instead.
    expect(updateCloudIconCoverSpy).not.toHaveBeenCalled();
    expect(updatePublicIconCoverSpy).not.toHaveBeenCalled();
    expect(updateMetadataSpy).toHaveBeenCalledWith(
      'icon-offline-id',
      expect.objectContaining({ icon: { type: 'emoji', value: '📴' } })
    );
    expect(readPendingSyncEdits('icon-offline-id')).toBeGreaterThan(0);
    // The counter alone cannot replay the edit, so the exact payload the online
    // path would PATCH is queued beside it.
    expect(readPendingIconCoverPatch('icon-offline-id')).toEqual({
      icon: { type: 'emoji', value: '📴' },
    });
  });

  it('should queue an explicit clear for an icon removed while offline', async () => {
    const ydoc = new Y.Doc();
    const existingIcon = { type: 'builtin', value: 'barcode', color: 'pink' } as const;
    const meta = {
      title: 'Cloud Document',
      icon: existingIcon,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-offline-clear',
      isInitializing: false,
    });
    (useNetworkStatus as jest.Mock).mockReturnValue({
      isOnline: false,
      isOffline: true,
    });

    loadDocumentSpy.mockResolvedValueOnce({ ydoc, meta });
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('icon-offline-clear-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateIcon(null);
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toBeUndefined();
    });

    // A cleared icon is simply absent from the queued meta, and the API reads an
    // absent icon as "leave unchanged", so the reconnect needs this explicit null
    // payload or the removal is silently undone on the next load.
    expect(readPendingIconCoverPatch('icon-offline-clear-id')).toEqual({
      icon: { type: null, value: null },
    });
    expect(updateCloudIconCoverSpy).not.toHaveBeenCalled();
  });

  it('should fall back to local persist plus pending sync on connectivity loss without rolling back', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Cloud Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-flaky',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateCloudIconCoverSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('icon-flaky-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateIcon({ type: 'emoji', value: '🌩️' });
    });

    // The optimistic icon stays: connectivity failures persist locally and
    // queue a sync instead of rolling back.
    await waitFor(() => {
      expect(result.current.meta?.icon).toEqual({ type: 'emoji', value: '🌩️' });
    });

    await waitFor(() => {
      expect(updateMetadataSpy).toHaveBeenCalledWith(
        'icon-flaky-id',
        expect.objectContaining({ icon: { type: 'emoji', value: '🌩️' } })
      );
    });
    expect(readPendingSyncEdits('icon-flaky-id')).toBeGreaterThan(0);
  });

  it('should ignore updateIcon and updateCover on a read-only document', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Read Only',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-view',
    });
    getMyAccessSpy.mockResolvedValue({
      documentId: 'icon-readonly-id',
      allowed: true,
      accessLevel: 'VIEW',
      owner: false,
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result } = renderHook(() => useDocument('icon-readonly-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isReadOnly).toBe(true);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await act(async () => {
        result.current.updateIcon({ type: 'emoji', value: '🚫' });
        result.current.updateCover({
          type: 'link',
          value: 'https://cdn.example/c.jpg',
          position: 0.5,
        });
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(updateCloudIconCoverSpy).not.toHaveBeenCalled();
    expect(updateMetadataSpy).not.toHaveBeenCalled();
    expect(result.current.meta?.icon).toBeUndefined();
    expect(result.current.meta?.cover).toBeUndefined();
    expect(ydoc.getMap('meta').has('icon')).toBe(false);
    expect(ydoc.getMap('meta').has('cover')).toBe(false);
  });

  it('should seed the Yjs meta map for a document created before meta sync existed', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Legacy Doc',
      icon: { type: 'emoji', value: '📜' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-seed',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result } = renderHook(() => useDocument('seed-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // A late joiner receives the current values over the live channel.
    await waitFor(() => {
      expect(ydoc.getMap('meta').get('title')).toBe('Legacy Doc');
    });
    expect(ydoc.getMap('meta').get('icon')).toBe(JSON.stringify(meta.icon));
  });

  it('should apply a remote icon deletion observed on the Yjs map', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Shared Doc',
      icon: { type: 'emoji', value: '📝' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-remote-delete',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result } = renderHook(() => useDocument('remote-delete-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.meta?.icon).toEqual(meta.icon);

    // A collaborator's delete transaction arrives as a real map deletion —
    // not mere absence — so the local icon is cleared without a REST write.
    await act(async () => {
      ydoc.getMap('meta').delete('icon');
    });

    await waitFor(() => {
      expect(result.current.meta?.icon).toBeUndefined();
    });
    expect(updateCloudIconCoverSpy).not.toHaveBeenCalled();
  });

  it('should ignore hand-crafted garbage on the Yjs icon key', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Shared Doc',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-garbage',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

    const { result } = renderHook(() => useDocument('garbage-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Non-string values and unparseable JSON must never reach the DOM or Redux.
    await act(async () => {
      ydoc.getMap('meta').set('icon', 42 as never);
    });
    await act(async () => {
      ydoc.getMap('meta').set('icon', 'not-json{{{');
    });
    await act(async () => {
      ydoc.getMap('meta').set('icon', JSON.stringify({ type: 'link', value: 'javascript:x' }));
    });

    expect(result.current.meta?.icon).toBeUndefined();
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

    expect(getCloudDocumentSpy).toHaveBeenCalledWith('cloud-id', 'token-1', {
      includeTrashed: true,
    });
    expect(saveDocumentSpy).toHaveBeenCalledWith('cloud-id', ydoc, meta, {
      touchUpdatedAt: false,
      origin: 'local',
    });
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

  it('waits for a queued cloud create before polling access or connecting realtime', async () => {
    const offlineId = '11111111-2222-4333-8444-555555555555';
    const localYdoc = new Y.Doc();
    const localMeta = {
      title: 'Offline Draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    queuePendingCloudCreate({ id: offlineId, userId: 'user-1', parentId: null });
    loadDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });

    const { result } = renderHook(() => useDocument(offlineId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.meta?.title).toBe('Offline Draft');
    expect(getCloudDocumentSpy).not.toHaveBeenCalled();
    // No cloud row yet: /my-access answers {allowed:false} and a realtime
    // connect answers 1008, both of which would lock the page for good.
    expect(getMyAccessSpy).not.toHaveBeenCalled();
    expect(WebsocketProvider).not.toHaveBeenCalled();

    removePendingCloudCreate(offlineId);

    await waitFor(() => {
      expect(getMyAccessSpy).toHaveBeenCalledWith(offlineId, 'token-1');
    });
    expect(WebsocketProvider).toHaveBeenCalled();
  });

  it('stops waiting for a queued create replayed by another tab', async () => {
    const offlineId = '11111111-2222-4333-8444-555555555555';
    const localYdoc = new Y.Doc();
    const localMeta = {
      title: 'Offline Draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    queuePendingCloudCreate({ id: offlineId, userId: 'user-1', parentId: null });
    loadDocumentSpy.mockResolvedValue({ ydoc: localYdoc, meta: localMeta });

    const { result } = renderHook(() => useDocument(offlineId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(getMyAccessSpy).not.toHaveBeenCalled();

    // The other tab owned the key: this tab only sees it disappear through the
    // storage event, so the queue notification never fires here.
    window.localStorage.removeItem(`nextdocs:pending-cloud-create:${offlineId}`);
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: `nextdocs:pending-cloud-create:${offlineId}` })
      );
    });

    await waitFor(() => {
      expect(getMyAccessSpy).toHaveBeenCalledWith(offlineId, 'token-1');
    });
  });

  it('retries a restricted document once its queued create is no longer pending', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const recoveredYdoc = new Y.Doc();
    const recoveredMeta = {
      title: 'Recovered Offline Draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    getCloudDocumentSpy
      .mockRejectedValueOnce(new DocumentServiceApiError('Not found', 404))
      .mockResolvedValueOnce({ ydoc: recoveredYdoc, meta: recoveredMeta });

    const { result } = renderHook(() => useDocument('queued-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.errorState?.kind).toBe('restricted');
    });

    act(() => {
      queuePendingCloudCreate({ id: 'queued-id', userId: 'user-1', parentId: null });
    });
    act(() => {
      removePendingCloudCreate('queued-id');
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Recovered Offline Draft');
    });

    expect(result.current.errorState).toBeNull();
    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(2);
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

  it('should normalize a blank title to Untitled instead of sending blank to the cloud', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 't',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-blank',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateCloudMetadataSpy.mockResolvedValue(undefined);
    updateMetadataSpy.mockResolvedValue(undefined);

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDocument('cloud-blank-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Clearing "th" down to "" (the reported repro) must not PATCH a blank
    // title: blank is normalized to Untitled, which the textarea renders as
    // empty, so the previous "t" must not snap back via rollback.
    await act(async () => {
      result.current.updateMeta({ title: '' });
    });

    await waitFor(() => {
      expect(updateCloudMetadataSpy).toHaveBeenCalledWith(
        'cloud-blank-id',
        { title: 'Untitled' },
        'token-blank'
      );
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Untitled');
    });

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      'Failed to persist metadata update:',
      expect.anything()
    );

    consoleErrorSpy.mockRestore();
  });

  it('should normalize a whitespace-only title to Untitled in local metadata', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 't',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocument('test-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: '   ' });
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Untitled');
    });

    expect(updateMetadataSpy).toHaveBeenCalledWith(
      'test-id',
      expect.objectContaining({ title: 'Untitled' })
    );
  });

  it('should send Untitled from a guest that clears the title on a share link', async () => {
    useGuestAuth();
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Editable Share',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getPublicDocumentSpy.mockResolvedValue({ ydoc, meta, accessLevel: 'EDIT' });
    updatePublicMetadataSpy.mockResolvedValue(undefined);
    updateMetadataSpy.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => useDocument('shared-blank-id', { isSharedDocument: true }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The anonymous PATCH travels without a token, so it cannot lean on the
    // authenticated path's normalization: the cache and the server have to see
    // the same Untitled the reducer already renders.
    await act(async () => {
      result.current.updateMeta({ title: '  ' });
    });

    await waitFor(() => {
      expect(updatePublicMetadataSpy).toHaveBeenCalledWith('shared-blank-id', {
        title: 'Untitled',
      });
    });

    expect(updateMetadataSpy).toHaveBeenCalledWith(
      'shared-blank-id',
      expect.objectContaining({ title: 'Untitled' })
    );

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Untitled');
    });
  });

  it('should not roll back a newer title when an older metadata write fails', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 't',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-race',
    });
    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    updateMetadataSpy.mockResolvedValue(undefined);

    let rejectFirst!: (reason?: unknown) => void;
    const firstWrite = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    firstWrite.catch(() => {});
    updateCloudMetadataSpy.mockReturnValueOnce(firstWrite).mockResolvedValueOnce(undefined);

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDocument('race-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateMeta({ title: 'First' });
    });

    await act(async () => {
      result.current.updateMeta({ title: 'Second' });
    });

    await act(async () => {
      rejectFirst(new Error('stale failure'));
      await firstWrite.catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(result.current.meta?.title).toBe('Second');
    });

    consoleErrorSpy.mockRestore();
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
    expect(getCloudDocumentSpy).toHaveBeenLastCalledWith('cloud-id', 'token-1', {
      includeTrashed: true,
    });

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
        jest.advanceTimersByTime(15000);
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

    getCloudDocumentSpy.mockRejectedValue(new Error('Failed'));

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

    getCloudDocumentSpy.mockResolvedValue({
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

    getCloudDocumentSpy
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
    getCloudDocumentSpy.mockReturnValue(loadPromise);

    const { unmount } = renderHook(() => useDocument('test-id'), {
      wrapper: createWrapper(),
    });

    unmount();

    resolveLoad?.({ ydoc, meta });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(getCloudDocumentSpy).toHaveBeenCalledTimes(1);
  });

  it('should return a stable updateMeta reference across re-renders', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Test',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
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

  it('should restore a document, update local Redux state and cache access level to OWNER', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Trashed Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: '2024-01-02T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-restore-test',
    });

    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    restoreCloudDocumentFromTrashSpy.mockResolvedValue(undefined);
    getMyAccessSpy.mockResolvedValue({
      documentId: 'trashed-id',
      allowed: true,
      accessLevel: 'OWNER',
      owner: true,
    });

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { result } = renderHook(() => useDocument('trashed-id'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.meta?.deletedAt).toBe('2024-01-02T00:00:00.000Z');

    await act(async () => {
      await result.current.restore();
    });

    expect(restoreCloudDocumentFromTrashSpy).toHaveBeenCalledWith(
      'trashed-id',
      'token-restore-test'
    );

    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.meta?.deletedAt).toBeUndefined();
    expect(result.current.accessLevel).toBe('OWNER');
    expect(store.getState().document.meta?.deletedAt).toBeUndefined();
  });

  it('should restore document as an EDIT collaborator and retain EDIT accessLevel', async () => {
    const ydoc = new Y.Doc();
    const meta = {
      title: 'Collaborator Trashed Doc',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: '2024-01-02T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-restore-test',
    });

    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
    restoreCloudDocumentFromTrashSpy.mockResolvedValue(undefined);
    getMyAccessSpy.mockResolvedValue({
      documentId: 'trashed-collab-id',
      allowed: true,
      accessLevel: 'EDIT',
      owner: false,
    });

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { result } = renderHook(() => useDocument('trashed-collab-id'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.meta?.deletedAt).toBe('2024-01-02T00:00:00.000Z');

    await act(async () => {
      await result.current.restore();
    });

    expect(restoreCloudDocumentFromTrashSpy).toHaveBeenCalledWith(
      'trashed-collab-id',
      'token-restore-test'
    );

    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.meta?.deletedAt).toBeUndefined();
    expect(result.current.accessLevel).toBe('EDIT');
    expect(store.getState().document.meta?.deletedAt).toBeUndefined();
  });

  it('should detect external restore (e.g. from sidebar), update local Redux state and cache access level to OWNER', async () => {
    const ydoc = new Y.Doc();
    const trashedMeta = {
      title: 'Trashed Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: '2024-01-02T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-restore-test',
    });

    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta: trashedMeta });
    getMyAccessSpy.mockResolvedValue({
      documentId: 'external-id',
      allowed: true,
      accessLevel: 'OWNER',
      owner: true,
    });

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { result } = renderHook(() => useDocument('external-id'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.meta?.deletedAt).toBe('2024-01-02T00:00:00.000Z');

    const restoredMeta = {
      ...trashedMeta,
      deletedAt: undefined,
    };
    loadDocumentSpy.mockResolvedValue({ ydoc, meta: restoredMeta });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('local-documents-changed'));
    });

    await waitFor(() => {
      expect(result.current.isReadOnly).toBe(false);
    });

    expect(result.current.meta?.deletedAt).toBeUndefined();
    expect(result.current.accessLevel).toBe('OWNER');
    expect(store.getState().document.meta?.deletedAt).toBeUndefined();
  });

  it('should detect external restore as an EDIT collaborator and retain EDIT accessLevel', async () => {
    const ydoc = new Y.Doc();
    const trashedMeta = {
      title: 'Trashed Document',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: '2024-01-02T00:00:00.000Z',
    };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-restore-test',
    });

    getCloudDocumentSpy.mockResolvedValue({ ydoc, meta: trashedMeta });
    getMyAccessSpy.mockResolvedValue({
      documentId: 'external-collab-id',
      allowed: true,
      accessLevel: 'EDIT',
      owner: false,
    });

    const store = createTestStore();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    }

    const { result } = renderHook(() => useDocument('external-collab-id'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.meta?.deletedAt).toBe('2024-01-02T00:00:00.000Z');

    const restoredMeta = {
      ...trashedMeta,
      deletedAt: undefined,
    };
    loadDocumentSpy.mockResolvedValue({ ydoc, meta: restoredMeta });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('local-documents-changed'));
    });

    await waitFor(() => {
      expect(result.current.isReadOnly).toBe(false);
    });

    expect(result.current.meta?.deletedAt).toBeUndefined();
    expect(result.current.accessLevel).toBe('EDIT');
    expect(store.getState().document.meta?.deletedAt).toBeUndefined();
  });

  describe('realtime access revalidation and close handling', () => {
    const validUuid = '12345678-1234-1234-1234-123456789012';

    beforeEach(() => {
      registeredStatusHandler = null;
      registeredCloseHandler = null;
      mockOn.mockClear();
      mockOff.mockClear();
      mockDestroy.mockClear();
      mockSetLocalStateField.mockClear();
    });

    it('reconnects with the rotated token after a refresh', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      const authState = {
        isAuthenticated: true,
        accessToken: 'token-old',
        isInitializing: false,
        refresh: mockRefreshSession,
      };

      (useAuth as jest.Mock).mockImplementation(() => authState);
      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

      const { result, rerender } = renderHook(() => useDocument(validUuid), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      await waitFor(() => {
        expect(WebsocketProvider).toHaveBeenCalledTimes(1);
      });

      authState.accessToken = 'token-new';
      rerender();

      await waitFor(() => {
        expect(WebsocketProvider).toHaveBeenCalledTimes(2);
      });
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it('should skip access polling when isRealtimeConnected is true', async () => {
      jest.useFakeTimers();

      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-realtime',
        isInitializing: false,
        refresh: mockRefreshSession,
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
      getMyAccessSpy.mockResolvedValue({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await act(async () => {
        // Flush initial mount loadDoc promise chain
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify the websocket provider was created and status handler was registered
      expect(registeredStatusHandler).not.toBeNull();

      // Simulate websocket connection status change to 'connected'
      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });

      // Advance timers by 15000ms. Since isRealtimeConnected is true, polling should be skipped.
      getMyAccessSpy.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(15000);
        await Promise.resolve();
      });

      // getMyAccess should NOT have been called again (which would happen if client polled)
      expect(getMyAccessSpy).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should handle websocket 1008 close code by verifying access and refreshing token on 401', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const refresh = jest.fn();
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-realtime',
        isInitializing: false,
        refresh,
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

      // Initial access check is allowed
      getMyAccessSpy.mockResolvedValueOnce({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await act(async () => {
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(registeredCloseHandler).not.toBeNull();
      expect(registeredStatusHandler).not.toBeNull();

      // Simulate websocket connection status change to 'connected'
      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });

      // Mock getMyAccess during close to throw 401 (stale session)
      getMyAccessSpy.mockRejectedValueOnce(new DocumentServiceApiError('Unauthorized', 401));

      // Simulate connection close with 1008
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });

      // Verify refresh was triggered and errorState was not set to restricted
      await waitFor(() => {
        expect(refresh).toHaveBeenCalledTimes(1);
      });
      expect(result.current.errorState).toBeNull();
    });

    it('should handle websocket 1008 close code by showing restricted error on 403/404', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-realtime',
        isInitializing: false,
        refresh: mockRefreshSession,
      });

      getCloudDocumentSpy.mockResolvedValueOnce({ ydoc, meta });

      // Initial access check is allowed
      getMyAccessSpy.mockResolvedValueOnce({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await act(async () => {
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(registeredCloseHandler).not.toBeNull();
      expect(registeredStatusHandler).not.toBeNull();

      // Simulate websocket connection status change to 'connected'
      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });

      // Mock getMyAccess to throw 403 (access revoked)
      getMyAccessSpy.mockRejectedValueOnce(new DocumentServiceApiError('Forbidden', 403));

      // Simulate connection close with 1008
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });

      // Verify UI is transitioned to restricted error state
      await waitFor(() => {
        expect(result.current.errorState).toMatchObject({
          kind: 'restricted',
          statusCode: 403,
        });
      });
      expect(result.current.ydoc).toBeNull();
    });

    it('should keep reconnecting when the access re-check after a 1008 close fails transiently', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-transient',
        isInitializing: false,
        refresh: mockRefreshSession,
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
      getMyAccessSpy.mockResolvedValue({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(registeredCloseHandler).not.toBeNull();
      mockProviderInstance.shouldConnect = true;

      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });

      // The client lost the network while the socket was closing: neither an
      // expired token nor a revocation, just a failed re-check.
      getMyAccessSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });

      // The handler stops reconnection while it decides, then has to hand control
      // back; otherwise the socket stays closed for the rest of the session.
      expect(mockProviderInstance.shouldConnect).toBe(false);

      // y-websocket already spent its one retry by the time this slow round trip
      // answers, so the flag alone would not reopen anything.
      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalledTimes(1);
      });
      expect(result.current.errorState).toBeNull();
    });

    it('should keep reconnecting when the trashed-copy fetch after a 1008 close fails transiently', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-trash-transient',
        isInitializing: false,
        refresh: mockRefreshSession,
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
      getMyAccessSpy.mockResolvedValue({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(registeredCloseHandler).not.toBeNull();
      mockProviderInstance.shouldConnect = true;

      // The document left the trash scope it loaded with, so the close handler
      // asks for the trashed copy to tell a trash move from a revocation.
      getMyAccessSpy.mockResolvedValue({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
        trashed: true,
      });

      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });

      // The trash follow-up fails on a flaky link; nothing proves revocation.
      getCloudDocumentSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });

      expect(mockProviderInstance.shouldConnect).toBe(false);

      await waitFor(() => {
        expect(mockConnect).toHaveBeenCalledTimes(1);
      });
      expect(getCloudDocumentSpy).toHaveBeenCalledTimes(2);
      expect(result.current.errorState).toBeNull();
    });

    it('should back off repeated 1008 closes and reset once the socket reconnects', async () => {
      jest.useFakeTimers();

      const ydoc = new Y.Doc();
      const meta = {
        title: 'Realtime Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-close-backoff',
        isInitializing: false,
        refresh: mockRefreshSession,
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });
      getMyAccessSpy.mockResolvedValue({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'EDIT',
        owner: false,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await act(async () => {
        // Flush initial mount loadDoc promise chain
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await waitFor(() => {
        expect(registeredCloseHandler).not.toBeNull();
      });
      mockProviderInstance.shouldConnect = true;

      const flushMicrotasks = async () => {
        await act(async () => {
          for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
          }
        });
      };

      // First close: the access re-check passes, so the resume needs no wait.
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });
      await flushMicrotasks();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Second close: the retry waits (500ms base), so a server that keeps
      // refusing is not hit as fast as the close arrives.
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });
      await flushMicrotasks();
      await act(async () => {
        jest.advanceTimersByTime(499);
      });
      expect(mockConnect).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(mockConnect).toHaveBeenCalledTimes(2);

      // A live socket means the closes are behind us: the backoff and the
      // reconnect it had scheduled are dropped, so the next close is immediate.
      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });
      await flushMicrotasks();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(mockConnect).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });

    it('should not establish realtime connection for a trashed document owned by the user', async () => {
      const ydoc = new Y.Doc();
      const trashedMeta = {
        title: 'Trashed Document',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: '2024-01-02T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-trashed',
        isInitializing: false,
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta: trashedMeta });
      getMyAccessSpy.mockResolvedValue({
        documentId: validUuid,
        allowed: true,
        accessLevel: 'OWNER',
        owner: true,
        trashed: true,
      });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // The trashed document loads read-only for the owner with their real trash-scope
      // access level (drives the manage-style trash banner).
      expect(result.current.meta?.deletedAt).toBe('2024-01-02T00:00:00.000Z');
      expect(result.current.accessLevel).toBe('OWNER');
      expect(result.current.isReadOnly).toBe(true);
      expect(result.current.errorState).toBeNull();
      expect(result.current.ydoc).toBe(ydoc);
      expect(getMyAccessSpy).toHaveBeenCalled();

      // No realtime provider should be created for a trashed document: the realtime
      // server strictly rejects access checks for trashed docs (1008 close), which would
      // otherwise trigger a spurious "access restricted" error for the owner.
      expect(mockOn).not.toHaveBeenCalled();
      expect(registeredStatusHandler).toBeNull();
      expect(registeredCloseHandler).toBeNull();
    });

    it('should keep a trashed document open as a read-only trash view when realtime access is revoked after the doc is trashed elsewhere', async () => {
      const ydoc = new Y.Doc();
      const activeMeta = {
        title: 'Active Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      const trashedMeta = {
        ...activeMeta,
        deletedAt: '2024-01-02T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-trashed-elsewhere',
        isInitializing: false,
      });

      // getCloudDocument: initial load returns the active doc; the realtime close-handler
      // re-check returns the trashed copy (the user can still view it via REST).
      getCloudDocumentSpy
        .mockResolvedValueOnce({ ydoc, meta: activeMeta })
        .mockResolvedValueOnce({ ydoc, meta: trashedMeta });

      // getMyAccess: the loadDoc check sees an active document; the realtime close-handler
      // recheck reports the document is now trashed with pre-trash access preserved.
      getMyAccessSpy
        .mockResolvedValueOnce({
          documentId: validUuid,
          allowed: true,
          accessLevel: 'EDIT',
          owner: false,
        })
        .mockResolvedValueOnce({
          documentId: validUuid,
          allowed: true,
          accessLevel: 'EDIT',
          owner: false,
          trashed: true,
        });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await act(async () => {
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(registeredCloseHandler).not.toBeNull();
      expect(registeredStatusHandler).not.toBeNull();

      act(() => {
        registeredStatusHandler!({ status: 'connected' });
      });

      // Simulate the realtime server closing the connection after its periodic access
      // revalidation rejects the now-trashed document.
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });

      // The user keeps seeing the document as a read-only trash view instead of a
      // spurious "access restricted" error, with their real pre-trash access level.
      await waitFor(() => {
        expect(result.current.errorState).toBeNull();
      });
      expect(result.current.meta?.deletedAt).toBe('2024-01-02T00:00:00.000Z');
      expect(result.current.accessLevel).toBe('EDIT');
      expect(result.current.isReadOnly).toBe(true);
      expect(result.current.ydoc).toBe(ydoc);
    });

    it('should fallback to VIEW accessLevel when getMyAccess transiently fails for a trashed doc', async () => {
      const ydoc = new Y.Doc();
      const trashedMeta = {
        title: 'Trashed Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: '2024-01-02T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-1',
      });

      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta: trashedMeta });
      getMyAccessSpy.mockRejectedValueOnce(new TypeError('Network error'));

      const { result } = renderHook(() => useDocument('trashed-doc-id'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.accessLevel).toBe('VIEW');
      expect(result.current.isReadOnly).toBe(true);
    });

    it('should not enter restricted state if a document was restored between getMyAccess and getCloudDocument on close', async () => {
      const ydoc = new Y.Doc();
      const activeMeta = {
        title: 'Restored Document',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const validUuid = '550e8400-e29b-41d4-a716-446655440000';

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-race-test',
      });

      // Initial load: returns active doc
      // Close recheck: returns active restored doc (deletedAt is undefined)
      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta: activeMeta });

      // getMyAccess in close handler saw trashed: true
      getMyAccessSpy
        .mockResolvedValueOnce({
          documentId: validUuid,
          allowed: true,
          accessLevel: 'EDIT',
          owner: false,
        })
        .mockResolvedValueOnce({
          documentId: validUuid,
          allowed: true,
          accessLevel: 'EDIT',
          owner: false,
          trashed: true,
        });

      const { result } = renderHook(() => useDocument(validUuid), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(registeredCloseHandler).not.toBeNull();

      // Trigger 1008 close
      act(() => {
        registeredCloseHandler!({ code: 1008 });
      });

      // Document was restored, so access should NOT be revoked (no restricted error)
      await act(async () => {
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });

      expect(result.current.errorState).toBeNull();
      expect(result.current.meta?.deletedAt).toBeUndefined();
    });

    it('should initialize isReadOnly to true for shared documents before getMyAccess resolves', async () => {
      const ydoc = new Y.Doc();
      const meta = {
        title: 'Shared Document',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-shared',
      });

      let resolveAccess!: (val: unknown) => void;
      const accessPromise = new Promise((res) => {
        resolveAccess = res;
      });
      getMyAccessSpy.mockReturnValue(accessPromise);
      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta });

      const { result } = renderHook(
        () => useDocument('shared-doc-id', { isSharedDocument: true }),
        { wrapper: createWrapper() }
      );

      // Initially, isReadOnly must be true (safe default for shared docs)
      expect(result.current.isReadOnly).toBe(true);

      // Now resolve access to EDIT
      await act(async () => {
        resolveAccess({
          documentId: 'shared-doc-id',
          allowed: true,
          accessLevel: 'EDIT',
          owner: false,
        });
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.accessLevel).toBe('EDIT');
      expect(result.current.isReadOnly).toBe(false);
    });

    it('should preserve cached accessLevel on trashed document when network error occurs', async () => {
      const ydoc = new Y.Doc();
      const trashedMeta = {
        title: 'Trashed Doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: '2024-01-02T00:00:00.000Z',
      };

      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'token-1',
      });

      writeCachedDocumentAccessLevel('cached-trash-id', 'EDIT');
      getCloudDocumentSpy.mockResolvedValue({ ydoc, meta: trashedMeta });
      getMyAccessSpy.mockRejectedValueOnce(new TypeError('Network error'));

      const { result } = renderHook(() => useDocument('cached-trash-id'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.accessLevel).toBe('EDIT');
      expect(result.current.isReadOnly).toBe(true);
    });
  });
});
