import {
  readPendingSyncEdits,
  writePendingSyncEdits,
  incrementPendingSyncEdits,
  clearPendingSyncEdits,
  readPendingIconCoverPatch,
  mergePendingIconCoverPatch,
  clearPendingIconCoverPatch,
  PENDING_SYNC_EVENT,
} from '../../../lib/offline-sync.util';

describe('offline-sync.util', () => {
  const documentId = 'test-doc-123';
  const storageKey = `nextdocs:pending-sync:${documentId}`;

  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  describe('readPendingSyncEdits', () => {
    it('returns 0 if no value in localStorage', () => {
      expect(readPendingSyncEdits(documentId)).toBe(0);
    });

    it('returns the parsed number from localStorage', () => {
      window.localStorage.setItem(storageKey, '5');
      expect(readPendingSyncEdits(documentId)).toBe(5);
    });

    it('returns 0 if value is not a valid number', () => {
      window.localStorage.setItem(storageKey, 'not-a-number');
      expect(readPendingSyncEdits(documentId)).toBe(0);
    });

    it('returns 0 if value is <= 0', () => {
      window.localStorage.setItem(storageKey, '0');
      expect(readPendingSyncEdits(documentId)).toBe(0);
      window.localStorage.setItem(storageKey, '-1');
      expect(readPendingSyncEdits(documentId)).toBe(0);
    });
  });

  describe('writePendingSyncEdits', () => {
    it('saves the value to localStorage', () => {
      writePendingSyncEdits(documentId, 10);
      expect(window.localStorage.getItem(storageKey)).toBe('10');
    });

    it('removes the key from localStorage if value is <= 0', () => {
      window.localStorage.setItem(storageKey, '5');
      writePendingSyncEdits(documentId, 0);
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });

    it('dispatches a PENDING_SYNC_EVENT when updated', () => {
      const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
      writePendingSyncEdits(documentId, 3);

      expect(dispatchSpy).toHaveBeenCalled();
      const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe(PENDING_SYNC_EVENT);
      expect(event.detail).toEqual({
        documentId,
        pendingEdits: 3,
      });
    });
  });

  describe('incrementPendingSyncEdits', () => {
    it('increments the current value', () => {
      window.localStorage.setItem(storageKey, '2');
      incrementPendingSyncEdits(documentId, 1);
      expect(window.localStorage.getItem(storageKey)).toBe('3');
    });

    it('defaults to incrementing by 1', () => {
      window.localStorage.setItem(storageKey, '5');
      incrementPendingSyncEdits(documentId);
      expect(window.localStorage.getItem(storageKey)).toBe('6');
    });

    it('works starting from zero', () => {
      incrementPendingSyncEdits(documentId, 5);
      expect(window.localStorage.getItem(storageKey)).toBe('5');
    });
  });

  describe('clearPendingSyncEdits', () => {
    it('sets the value to 0 and removes from storage', () => {
      window.localStorage.setItem(storageKey, '10');
      clearPendingSyncEdits(documentId);
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
  });

  describe('pending icon/cover patch', () => {
    const patchKey = `nextdocs:pending-icon-cover:${documentId}`;
    const clearIcon = { type: null, value: null };
    const cover = {
      type: 'upload',
      value: '11111111-2222-4333-8444-555555555555',
      position: 0.25,
    };

    it('reads null when nothing is queued', () => {
      expect(readPendingIconCoverPatch(documentId)).toBeNull();
    });

    it('keeps a clear payload, the shape the meta cannot express', () => {
      mergePendingIconCoverPatch(documentId, { icon: clearIcon });
      expect(readPendingIconCoverPatch(documentId)).toEqual({ icon: clearIcon });
    });

    it('merges an icon edit and a later cover edit into one patch', () => {
      mergePendingIconCoverPatch(documentId, { icon: { type: 'emoji', value: '📝' } });
      mergePendingIconCoverPatch(documentId, { cover });

      expect(readPendingIconCoverPatch(documentId)).toEqual({
        icon: { type: 'emoji', value: '📝' },
        cover,
      });
    });

    it('replaces the earlier value for the same key', () => {
      mergePendingIconCoverPatch(documentId, { icon: { type: 'emoji', value: '📝' } });
      mergePendingIconCoverPatch(documentId, { icon: clearIcon });

      expect(readPendingIconCoverPatch(documentId)).toEqual({ icon: clearIcon });
    });

    it('writes nothing for a merge that changes neither key', () => {
      mergePendingIconCoverPatch(documentId, {});
      expect(window.localStorage.getItem(patchKey)).toBeNull();
    });

    it('treats unreadable queued state as nothing to replay', () => {
      window.localStorage.setItem(patchKey, '{not json');
      expect(readPendingIconCoverPatch(documentId)).toBeNull();
    });

    it('ignores a payload that is not an object', () => {
      window.localStorage.setItem(patchKey, '7');
      expect(readPendingIconCoverPatch(documentId)).toBeNull();
    });

    it('drops the patch once it has been replayed', () => {
      mergePendingIconCoverPatch(documentId, { icon: clearIcon });
      clearPendingIconCoverPatch(documentId);

      expect(readPendingIconCoverPatch(documentId)).toBeNull();
      expect(window.localStorage.getItem(patchKey)).toBeNull();
    });
  });
});
