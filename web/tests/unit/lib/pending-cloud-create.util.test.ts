import {
  discardPendingDocument,
  flushPendingCloudCreate,
  getPendingCloudCreate,
  listPendingCloudCreates,
  PENDING_CLOUD_CREATE_EVENT,
  queuePendingCloudCreate,
  removePendingCloudCreate,
} from '@/lib/pending-cloud-create.util';
import {
  mergePendingIconCoverPatch,
  readPendingIconCoverPatch,
  readPendingSyncEdits,
  writePendingSyncEdits,
} from '@/lib/offline-sync.util';
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
const saveDocument = documentService.saveDocument as jest.Mock;
const deleteDocument = documentService.deleteDocument as jest.Mock;

const localDocument = {
  ydoc: {} as never,
  meta: {
    title: 'Offline draft',
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

describe('pending cloud creates', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  it('keeps entries per user and replaces a repeated id', () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: 'parent-1' });
    queuePendingCloudCreate({ id: 'doc-2', userId: 'user-2', parentId: null });

    expect(listPendingCloudCreates('user-1')).toEqual([
      expect.objectContaining({ id: 'doc-1', parentId: 'parent-1' }),
    ]);
    expect(listPendingCloudCreates('user-2')).toEqual([expect.objectContaining({ id: 'doc-2' })]);
    expect(getPendingCloudCreate('doc-1')?.parentId).toBe('parent-1');
  });

  it('keeps a create queued by another tab when this tab queues its own', () => {
    window.localStorage.setItem(
      'nextdocs:pending-cloud-create:other-tab',
      JSON.stringify({
        id: 'other-tab',
        userId: 'user-1',
        parentId: null,
        queuedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    queuePendingCloudCreate({ id: 'this-tab', userId: 'user-1', parentId: null });

    expect(listPendingCloudCreates('user-1').map((entry) => entry.id)).toEqual([
      'other-tab',
      'this-tab',
    ]);
  });

  it('survives a storage write that hits the quota', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const listener = jest.fn();
    window.addEventListener(PENDING_CLOUD_CREATE_EVENT, listener);

    try {
      expect(() =>
        queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null })
      ).not.toThrow();

      expect(listPendingCloudCreates('user-1')).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to persist pending cloud creates:',
        expect.any(Error)
      );
    } finally {
      window.removeEventListener(PENDING_CLOUD_CREATE_EVENT, listener);
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('stores each entry under its own key', () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    queuePendingCloudCreate({ id: 'doc-2', userId: 'user-1', parentId: null });

    expect(window.localStorage.getItem('nextdocs:pending-cloud-create:doc-1')).not.toBeNull();
    expect(window.localStorage.getItem('nextdocs:pending-cloud-create:doc-2')).not.toBeNull();

    removePendingCloudCreate('doc-1');

    expect(getPendingCloudCreate('doc-1')).toBeNull();
    expect(getPendingCloudCreate('doc-2')).not.toBeNull();
  });

  it('hides a queued create from another account on the same device', () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });

    expect(getPendingCloudCreate('doc-1', 'user-2')).toBeNull();
    expect(getPendingCloudCreate('doc-1', 'user-1')).not.toBeNull();
  });

  it('discards the queued entry, local copy, and offline state', async () => {
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    writePendingSyncEdits('doc-1', 3);
    mergePendingIconCoverPatch('doc-1', { icon: { type: 'emoji', value: '📄' } });

    await discardPendingDocument('doc-1');

    expect(getPendingCloudCreate('doc-1')).toBeNull();
    expect(readPendingSyncEdits('doc-1')).toBe(0);
    expect(readPendingIconCoverPatch('doc-1')).toBeNull();
    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(documentService.emitLocalDocumentsChanged).toHaveBeenCalled();
  });

  it('notifies listeners when the queue changes', () => {
    const listener = jest.fn();
    window.addEventListener(PENDING_CLOUD_CREATE_EVENT, listener);

    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    removePendingCloudCreate('doc-1');

    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(PENDING_CLOUD_CREATE_EVENT, listener);
  });

  it('creates the queued document with its client id and parent', async () => {
    const entry = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: 'parent-1',
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    queuePendingCloudCreate(entry);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockResolvedValue({
      id: 'doc-1',
      ydoc: localDocument.ydoc,
      meta: localDocument.meta,
    });
    saveDocument.mockResolvedValue(undefined);

    await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('created');

    expect(createCloudDocument).toHaveBeenCalledWith(
      'token',
      'doc-1',
      'Offline draft',
      localDocument.ydoc,
      'user-1',
      'parent-1'
    );
    expect(getPendingCloudCreate('doc-1')).toBeNull();
    expect(documentService.emitCloudDocumentsChanged).toHaveBeenCalled();
  });

  it('keeps the entry when the create fails with a connectivity error', async () => {
    const entry = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    queuePendingCloudCreate(entry);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('retry');
    expect(getPendingCloudCreate('doc-1')).not.toBeNull();
  });

  it('keeps the entry when the token is stale', async () => {
    const entry = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    queuePendingCloudCreate(entry);
    loadDocument.mockResolvedValue(localDocument);
    // A 401 right after an offline reload is the refresh still in flight; the
    // queue must survive it, or the document never reaches the account.
    createCloudDocument.mockRejectedValue(new DocumentServiceApiError('Unauthorized', 401));

    await expect(flushPendingCloudCreate('stale-token', entry)).resolves.toBe('retry');
    expect(getPendingCloudCreate('doc-1')).not.toBeNull();
  });

  it('keeps a child queued while its pending parent waits to replay', async () => {
    queuePendingCloudCreate({ id: 'parent', userId: 'user-1', parentId: null });
    const child = {
      id: 'child',
      userId: 'user-1',
      parentId: 'parent',
      queuedAt: '2026-01-01T00:00:01.000Z',
    };
    queuePendingCloudCreate(child);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(flushPendingCloudCreate('token', child)).resolves.toBe('retry');

    expect(createCloudDocument).toHaveBeenCalledTimes(1);
    expect(getPendingCloudCreate('child')).not.toBeNull();
  });

  it('does not cache a created document after the account changes', async () => {
    const entry = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    queuePendingCloudCreate(entry);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockResolvedValue({
      id: 'doc-1',
      ydoc: localDocument.ydoc,
      meta: localDocument.meta,
    });
    (documentService.getCurrentUserId as jest.Mock).mockReturnValueOnce('user-2');

    await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('retry');

    expect(saveDocument).not.toHaveBeenCalled();
    expect(getPendingCloudCreate('doc-1')).not.toBeNull();
  });

  it('creates a pending parent before its pending child', async () => {
    queuePendingCloudCreate({ id: 'parent', userId: 'user-1', parentId: null });
    const child = {
      id: 'child',
      userId: 'user-1',
      parentId: 'parent',
      queuedAt: '2026-01-01T00:00:01.000Z',
    };
    queuePendingCloudCreate(child);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockImplementation(async (_token, id) => ({
      id,
      ydoc: localDocument.ydoc,
      meta: localDocument.meta,
    }));
    saveDocument.mockResolvedValue(undefined);

    await expect(flushPendingCloudCreate('token', child)).resolves.toBe('created');

    expect(createCloudDocument.mock.calls.map(([, id]) => id)).toEqual(['parent', 'child']);
    expect(listPendingCloudCreates('user-1')).toEqual([]);
  });

  it('creates the child at the root when its pending parent is refused', async () => {
    queuePendingCloudCreate({ id: 'parent', userId: 'user-1', parentId: null });
    const child = {
      id: 'child',
      userId: 'user-1',
      parentId: 'parent',
      queuedAt: '2026-01-01T00:00:01.000Z',
    };
    queuePendingCloudCreate(child);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockImplementation(async (_token, id) => {
      if (id === 'parent') {
        throw new DocumentServiceApiError('Bad request', 400);
      }
      return { id, ydoc: localDocument.ydoc, meta: localDocument.meta };
    });

    // Refusing the parent must not discard the child: it is a separate document
    // the user wrote, and it can live at the root.
    await expect(flushPendingCloudCreate('token', child)).resolves.toBe('created');

    expect(createCloudDocument.mock.calls.map(([, id, , , , parentId]) => [id, parentId])).toEqual([
      ['parent', null],
      ['child', null],
    ]);
    expect(getPendingCloudCreate('child')).toBeNull();
    expect(getPendingCloudCreate('parent')).toBeNull();
  });

  it.each([400, 403, 404, 409, 410, 422])(
    'drops a permanent %i rejection for a root document',
    async (status) => {
      const entry = {
        id: 'doc-1',
        userId: 'user-1',
        parentId: null,
        queuedAt: '2026-01-01T00:00:00.000Z',
      };
      queuePendingCloudCreate(entry);
      loadDocument.mockResolvedValue(localDocument);
      createCloudDocument.mockRejectedValue(
        new DocumentServiceApiError(`Rejected with ${status}`, status)
      );

      await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('dropped');
      expect(getPendingCloudCreate('doc-1')).not.toBeNull();
    }
  );

  it.each([408, 429, 500])('retries a transient %i rejection', async (status) => {
    const entry = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    queuePendingCloudCreate(entry);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockRejectedValue(
      new DocumentServiceApiError(`Transient with ${status}`, status)
    );

    await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('retry');
    expect(getPendingCloudCreate('doc-1')).not.toBeNull();
  });

  it('retries an unknown failure instead of discarding the document', async () => {
    const entry = {
      id: 'doc-1',
      userId: 'user-1',
      parentId: null,
      queuedAt: '2026-01-01T00:00:00.000Z',
    };
    queuePendingCloudCreate(entry);
    loadDocument.mockResolvedValue(localDocument);
    createCloudDocument.mockRejectedValue(new Error('Unexpected parser failure'));

    await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('retry');
    expect(getPendingCloudCreate('doc-1')).not.toBeNull();
  });

  it.each([403, 404])(
    'retries a %i parent rejection at the root before dropping',
    async (status) => {
      const entry = {
        id: 'doc-1',
        userId: 'user-1',
        parentId: 'parent-1',
        queuedAt: '2026-01-01T00:00:00.000Z',
      };
      queuePendingCloudCreate(entry);
      loadDocument.mockResolvedValue(localDocument);
      createCloudDocument.mockRejectedValueOnce(
        new DocumentServiceApiError(`Parent rejected with ${status}`, status)
      );
      createCloudDocument.mockResolvedValue({
        id: 'doc-1',
        ydoc: localDocument.ydoc,
        meta: localDocument.meta,
      });
      saveDocument.mockResolvedValue(undefined);

      await expect(flushPendingCloudCreate('token', entry)).resolves.toBe('created');

      expect(createCloudDocument.mock.calls.map(([, , , , , parentId]) => parentId)).toEqual([
        'parent-1',
        null,
      ]);
      expect(getPendingCloudCreate('doc-1')).toBeNull();
    }
  );

  it('forgets a discarded document even when its local copy cannot be deleted', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });
    writePendingSyncEdits('doc-1', 2);
    deleteDocument.mockRejectedValue(new Error('IndexedDB delete failed'));

    try {
      await expect(discardPendingDocument('doc-1')).resolves.toBeUndefined();

      expect(getPendingCloudCreate('doc-1')).toBeNull();
      expect(readPendingSyncEdits('doc-1')).toBe(0);
      expect(documentService.emitLocalDocumentsChanged).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
