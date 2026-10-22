import { act, renderHook, waitFor } from '@testing-library/react';
import { usePendingCloudDocumentCreates } from '@/hooks/usePendingCloudDocumentCreates.hook';
import { getPendingCloudCreate, queuePendingCloudCreate } from '@/lib/pending-cloud-create.util';
import { readPendingSyncEdits, writePendingSyncEdits } from '@/lib/offline-sync.util';
import { DocumentServiceApiError, documentService } from '@/services/document.service';

jest.mock('../../../services/document.service', () => {
  const actual = jest.requireActual('../../../services/document.service');
  return {
    ...actual,
    documentService: {
      ...actual.documentService,
      getCurrentUserId: jest.fn(() => 'user-1'),
      loadDocument: jest.fn(),
      createCloudDocument: jest.fn(),
      saveDocument: jest.fn(),
      deleteDocument: jest.fn(),
      emitCloudDocumentsChanged: jest.fn(),
      emitLocalDocumentsChanged: jest.fn(),
    },
  };
});

const loadDocument = documentService.loadDocument as jest.Mock;
const createCloudDocument = documentService.createCloudDocument as jest.Mock;
const deleteDocument = documentService.deleteDocument as jest.Mock;

const localDocument = {
  ydoc: {} as never,
  meta: {
    title: 'Offline draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

describe('usePendingCloudDocumentCreates', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockResolvedValue({
      id: 'doc-1',
      ydoc: localDocument.ydoc,
      meta: localDocument.meta,
    });
    (documentService.saveDocument as jest.Mock).mockResolvedValue(undefined);
    deleteDocument.mockResolvedValue(undefined);
  });

  it('flushes a queued create on mount', async () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });

    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    await waitFor(() => expect(createCloudDocument).toHaveBeenCalled());
    expect(getPendingCloudCreate('doc-1')).toBeNull();
  });

  it('flushes a create queued while the app is open', async () => {
    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    act(() => {
      queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    });

    await waitFor(() => expect(createCloudDocument).toHaveBeenCalled());
  });

  it('stops replaying an entry the queue cannot forget', async () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    // A queue remove that cannot be persisted leaves the entry behind; the
    // flush must not spin on it for the rest of the session.
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    try {
      renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

      await waitFor(() => expect(createCloudDocument).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(createCloudDocument).toHaveBeenCalledTimes(1);
    } finally {
      removeItem.mockRestore();
    }
  });

  it('keeps replaying later entries when an earlier one must wait', async () => {
    window.localStorage.setItem(
      'nextdocs:pending-cloud-create:doc-retry',
      JSON.stringify({
        id: 'doc-retry',
        userId: 'user-1',
        parentId: null,
        queuedAt: '2026-01-01T00:00:00.000Z',
      })
    );
    window.localStorage.setItem(
      'nextdocs:pending-cloud-create:doc-ok',
      JSON.stringify({
        id: 'doc-ok',
        userId: 'user-1',
        parentId: null,
        queuedAt: '2026-01-01T00:00:01.000Z',
      })
    );
    createCloudDocument.mockImplementation((_token, id) =>
      id === 'doc-retry'
        ? Promise.reject(new DocumentServiceApiError('Server error', 500))
        : Promise.resolve({ id, ydoc: localDocument.ydoc, meta: localDocument.meta })
    );

    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    // The retried entry must not stop the entry queued behind it.
    await waitFor(() => expect(createCloudDocument).toHaveBeenCalledTimes(2));
    expect(createCloudDocument.mock.calls.map(([, id]) => id)).toEqual(['doc-retry', 'doc-ok']);
    expect(getPendingCloudCreate('doc-retry')).not.toBeNull();
    expect(getPendingCloudCreate('doc-ok')).toBeNull();
  });

  it('flushes a create queued by another tab', async () => {
    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    await waitFor(() => expect(createCloudDocument).not.toHaveBeenCalled());

    act(() => {
      window.localStorage.setItem(
        'nextdocs:pending-cloud-create:doc-1',
        JSON.stringify({
          id: 'doc-1',
          userId: 'user-1',
          parentId: null,
          queuedAt: '2026-01-01T00:00:00.000Z',
        })
      );
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'nextdocs:pending-cloud-create:doc-1' })
      );
    });

    await waitFor(() => expect(createCloudDocument).toHaveBeenCalled());
  });

  it('does not replay an entry another tab removed from the queue', async () => {
    const createFirst = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    const removedElsewhere = {
      id: 'doc-2',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:01.000Z',
    };
    window.localStorage.setItem('nextdocs:pending-cloud-create:doc-1', JSON.stringify(createFirst));
    window.localStorage.setItem(
      'nextdocs:pending-cloud-create:doc-2',
      JSON.stringify(removedElsewhere)
    );

    let resolveFirst!: (value: unknown) => void;
    createCloudDocument.mockImplementation((_token, id) =>
      id === 'doc-1'
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({ id, ydoc: localDocument.ydoc, meta: localDocument.meta })
    );

    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    await waitFor(() => expect(createCloudDocument).toHaveBeenCalledTimes(1));

    act(() => {
      window.localStorage.removeItem('nextdocs:pending-cloud-create:doc-2');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'nextdocs:pending-cloud-create:doc-2' })
      );
    });

    await act(async () => {
      resolveFirst({ id: 'doc-1', ydoc: localDocument.ydoc, meta: localDocument.meta });
      await Promise.resolve();
    });

    await waitFor(() => expect(getPendingCloudCreate('doc-1')).toBeNull());
    expect(createCloudDocument).toHaveBeenCalledTimes(1);
    expect(createCloudDocument).toHaveBeenCalledWith(
      'token',
      'doc-1',
      'Offline draft',
      localDocument.ydoc,
      null,
      null
    );
    expect(getPendingCloudCreate('doc-2')).toBeNull();
  });

  it('flushes an entry queued while a flush is already running', async () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });

    let resolveFirst!: (value: unknown) => void;
    createCloudDocument.mockImplementation((_token, id) =>
      id === 'doc-1'
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({ id, ydoc: localDocument.ydoc, meta: localDocument.meta })
    );

    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    await waitFor(() => expect(createCloudDocument).toHaveBeenCalledTimes(1));

    act(() => {
      queuePendingCloudCreate({ id: 'doc-2', userId: 'user-1', parentId: null });
    });

    await act(async () => {
      resolveFirst({ id: 'doc-1', ydoc: localDocument.ydoc, meta: localDocument.meta });
      await Promise.resolve();
    });

    await waitFor(() => expect(createCloudDocument).toHaveBeenCalledTimes(2));
    expect(getPendingCloudCreate('doc-1')).toBeNull();
    expect(getPendingCloudCreate('doc-2')).toBeNull();
  });

  it('discards a rejected create and its offline state', async () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    writePendingSyncEdits('doc-1', 2);
    createCloudDocument.mockRejectedValue(new DocumentServiceApiError('Forbidden', 403));

    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith('doc-1'));
    expect(getPendingCloudCreate('doc-1')).toBeNull();
    expect(readPendingSyncEdits('doc-1')).toBe(0);
  });

  it('ignores queues belonging to another user', async () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-2', parentId: null });

    renderHook(() => usePendingCloudDocumentCreates('user-1', 'token'));

    await waitFor(() => expect(getPendingCloudCreate('doc-1')).not.toBeNull());
    expect(createCloudDocument).not.toHaveBeenCalled();
  });
});
