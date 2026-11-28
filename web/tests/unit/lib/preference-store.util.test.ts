import { createPreferenceStore } from '../../../lib/preference-store.util';

interface TestValue {
  collapsed: boolean;
  sections: string[];
}

const KEY = 'nextdocs:test-preference';

function makeStore() {
  return createPreferenceStore<TestValue>({
    key: KEY,
    version: 2,
    defaults: () => ({ collapsed: false, sections: [] }),
    parse: (payload) => ({
      collapsed: payload.collapsed === true,
      sections: Array.isArray(payload.sections)
        ? payload.sections.filter((entry): entry is string => typeof entry === 'string')
        : [],
    }),
    encode: (value) => ({ collapsed: value.collapsed, sections: value.sections }),
  });
}

describe('createPreferenceStore', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('falls back to the defaults when nothing is stored', () => {
    expect(makeStore().read()).toEqual({ collapsed: false, sections: [] });
  });

  it('does not share one defaults object between stores', () => {
    const first = makeStore().read();
    first.sections.push('mutated');

    expect(makeStore().read()).toEqual({ collapsed: false, sections: [] });
  });

  it('round-trips a value through storage', () => {
    makeStore().set({ collapsed: true, sections: ['private'] });
    expect(makeStore().read()).toEqual({ collapsed: true, sections: ['private'] });
  });

  it('ignores a payload written by another version', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, collapsed: true, sections: ['shared'] }));
    expect(makeStore().read()).toEqual({ collapsed: false, sections: [] });
  });

  it('ignores corrupt JSON instead of throwing', () => {
    localStorage.setItem(KEY, '{"v":2,');
    expect(makeStore().read()).toEqual({ collapsed: false, sections: [] });
  });

  it('falls back to the defaults when storage refuses the read', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, collapsed: true, sections: ['shared'] }));
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    const store = makeStore();
    expect(() => store.read()).not.toThrow();
    expect(store.read()).toEqual({ collapsed: false, sections: [] });
  });

  it('falls back to the defaults when the stored payload cannot be parsed', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, collapsed: true, sections: [] }));
    const store = createPreferenceStore<TestValue>({
      key: KEY,
      version: 2,
      defaults: () => ({ collapsed: false, sections: [] }),
      parse: () => {
        throw new Error('hostile payload');
      },
      encode: (value) => ({ collapsed: value.collapsed, sections: value.sections }),
    });

    expect(store.read()).toEqual({ collapsed: false, sections: [] });
  });

  it('keeps the session working when storage refuses the write', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const store = makeStore();
    expect(() => store.set({ collapsed: true, sections: [] })).not.toThrow();
    expect(store.read()).toEqual({ collapsed: true, sections: [] });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('notifies subscribers and tracks whether a sync is outstanding', () => {
    const store = makeStore();
    const listener = jest.fn();
    store.subscribe(listener);

    expect(store.hasPendingWrite()).toBe(false);
    store.set({ collapsed: true, sections: [] });
    expect(listener).toHaveBeenCalledWith({ collapsed: true, sections: [] });
    expect(store.hasPendingWrite()).toBe(true);

    store.markSynced();
    expect(store.hasPendingWrite()).toBe(false);
  });

  it('serializes exactly what it stores', () => {
    const store = makeStore();
    store.set({ collapsed: true, sections: ['shared'] });
    expect(localStorage.getItem(KEY)).toBe(store.serialize());
    expect(JSON.parse(store.serialize())).toEqual({
      v: 2,
      collapsed: true,
      sections: ['shared'],
    });
  });

  describe('applyExternal', () => {
    it('adopts a payload this device did not write and persists it', () => {
      const store = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      expect(store.applyExternal({ v: 2, collapsed: true, sections: ['spaces'] })).toBe(true);
      expect(store.read()).toEqual({ collapsed: true, sections: ['spaces'] });
      expect(listener).toHaveBeenCalledWith({ collapsed: true, sections: ['spaces'] });
      expect(localStorage.getItem(KEY)).not.toBeNull();
      // A remote value is not a local change waiting to be pushed back.
      expect(store.hasPendingWrite()).toBe(false);
    });

    it('accepts the stored JSON form', () => {
      const store = makeStore();
      expect(store.applyExternal(JSON.stringify({ v: 2, collapsed: true, sections: [] }))).toBe(
        true
      );
    });

    it('rejects a payload that is not an object', () => {
      const store = makeStore();

      expect(store.applyExternal(42)).toBe(false);
      expect(store.applyExternal('not a payload')).toBe(false);
      expect(store.read()).toEqual({ collapsed: false, sections: [] });
    });

    it('rejects a foreign version without touching the current value', () => {
      const store = makeStore();
      store.set({ collapsed: true, sections: [] });

      expect(store.applyExternal({ v: 1, collapsed: false, sections: [] })).toBe(false);
      expect(store.read()).toEqual({ collapsed: true, sections: [] });
    });

    it('can adopt without persisting', () => {
      const store = makeStore();
      store.applyExternal({ v: 2, collapsed: true, sections: [] }, { persist: false });
      expect(store.read()).toEqual({ collapsed: true, sections: [] });
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe('another tab', () => {
    it('follows a write from a different document', () => {
      const store = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY,
          newValue: JSON.stringify({ v: 2, collapsed: true, sections: ['shared'] }),
        })
      );

      expect(listener).toHaveBeenCalledWith({ collapsed: true, sections: ['shared'] });
      expect(store.read()).toEqual({ collapsed: true, sections: ['shared'] });
    });

    it('falls back to the defaults when the key is removed elsewhere', () => {
      const store = makeStore();
      store.set({ collapsed: true, sections: [] });

      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null }));

      expect(store.read()).toEqual({ collapsed: false, sections: [] });
    });

    it('ignores a storage event that names no key', () => {
      const store = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));

      expect(listener).not.toHaveBeenCalled();
    });

    it('falls back to the defaults for a corrupt cross-tab write', () => {
      const store = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '{"v":2,' }));

      expect(listener).toHaveBeenCalledWith({ collapsed: false, sections: [] });
      expect(store.read()).toEqual({ collapsed: false, sections: [] });
    });

    it('ignores other keys', () => {
      const store = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
