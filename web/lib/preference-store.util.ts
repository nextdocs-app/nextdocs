/**
 * A tiny typed, versioned `localStorage` preference store: one logical
 * preference per key.
 *
 * Local storage is the right home for rail chrome (it must be readable before
 * the first paint) but the wrong place to hard-code the shape of that state, so
 * this layer exists between the two. It is deliberately not `redux-persist`:
 * there is no React or Redux dependency, nothing serializes wholesale, and only
 * the handful of bytes that must survive a reload live here.
 *
 * Three properties matter:
 *
 * - Reads are cached. The boot script, the hydrate effect and the persistence
 *   subscriber all want the same value, and re-parsing JSON on each of them is
 *   pointless work in the critical path.
 * - Writes are defensive. Private mode, a sandboxed iframe and a quota error all
 *   degrade to the in-memory value instead of throwing inside a click handler.
 * - The value is the wire format. `serialize` produces exactly the JSON that is
 *   stored, so an account-sync layer can upload it unchanged and hand a server
 *   value back through `applyExternal` without it being echoed out again
 *   (`hasPendingWrite` / `markSynced`).
 */

export interface PreferenceStoreConfig<T> {
  /** Full `localStorage` key, including any identity scope. */
  key: string;
  /** Shape version. A payload with a different `v` falls back to `defaults`. */
  version: number;
  /** Fresh defaults. A factory keeps callers from sharing one mutable object. */
  defaults: () => T;
  /** Validates a decoded payload. `null` means "unusable, use `defaults`". */
  parse: (payload: Record<string, unknown>) => T | null;
  /** The payload stored next to `v`. Keep it flat and small. */
  encode: (value: T) => Record<string, unknown>;
}

export interface PreferenceStore<T> {
  readonly key: string;
  /** The current value, from storage on first use and from memory afterwards. */
  read(): T;
  set(next: T): void;
  /** Fires for local writes and for writes another tab made. */
  subscribe(listener: (value: T) => void): () => void;
  /** The exact JSON in storage, and that an account sync would send. */
  serialize(value?: T): string;
  /**
   * Adopt a payload this device did not write (account sync, another tab).
   * Accepts the stored JSON or its parsed form. Returns false for a payload
   * that does not match the current version.
   */
  applyExternal(payload: unknown, options?: { persist?: boolean }): boolean;
  /** True while this device holds a value an account sync has not confirmed. */
  hasPendingWrite(): boolean;
  markSynced(): void;
}

function resolveStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage;
  } catch {
    // Storage access throws outright when it is disabled.
    return null;
  }
}

/**
 * One `storage` listener for every store in this document, keyed by storage
 * key. Stores are scoped per identity and live for the page's lifetime, so a
 * listener per instance would accumulate for no benefit.
 */
const storageSubscribers = new Map<string, Set<(raw: string | null) => void>>();
let storageListenerInstalled = false;

function subscribeToStorage(key: string, listener: (raw: string | null) => void): void {
  let subscribers = storageSubscribers.get(key);
  if (!subscribers) {
    subscribers = new Set();
    storageSubscribers.set(key, subscribers);
  }
  subscribers.add(listener);

  if (storageListenerInstalled || typeof window === 'undefined') {
    return;
  }
  storageListenerInstalled = true;
  window.addEventListener('storage', (event) => {
    if (!event.key) {
      return;
    }
    for (const subscriber of storageSubscribers.get(event.key) ?? []) {
      subscriber(event.newValue);
    }
  });
}

export function createPreferenceStore<T>(config: PreferenceStoreConfig<T>): PreferenceStore<T> {
  const { key, version, defaults, parse, encode } = config;
  let cached: T | null = null;
  let pendingWrite = false;
  const listeners = new Set<(value: T) => void>();

  const decodeRecord = (payload: unknown): T | null => {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const record = payload as Record<string, unknown>;
    if (record.v !== version) {
      return null;
    }
    try {
      return parse(record);
    } catch {
      return null;
    }
  };

  const decodeRaw = (raw: string | null | undefined): T | null => {
    if (!raw) {
      return null;
    }
    try {
      return decodeRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const notify = (value: T) => {
    for (const listener of listeners) {
      listener(value);
    }
  };

  const read = (): T => {
    if (cached === null) {
      let raw: string | null;
      try {
        raw = resolveStorage()?.getItem(key) ?? null;
      } catch {
        // A sandboxed iframe can grant the object and still throw on read;
        // defaults serve this tab rather than failing the first paint.
        raw = null;
      }
      cached = decodeRaw(raw) ?? defaults();
    }
    return cached;
  };

  const serialize = (value: T = read()): string => JSON.stringify({ v: version, ...encode(value) });

  const write = (value: T) => {
    try {
      resolveStorage()?.setItem(key, serialize(value));
    } catch {
      // Quota or restricted storage: the in-memory value still serves this tab.
    }
  };

  const store: PreferenceStore<T> = {
    key,
    read,
    serialize,
    set(next) {
      cached = next;
      pendingWrite = true;
      write(next);
      notify(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyExternal(payload, options) {
      const next = typeof payload === 'string' ? decodeRaw(payload) : decodeRecord(payload);
      if (next === null) {
        return false;
      }
      cached = next;
      pendingWrite = false;
      if (options?.persist !== false) {
        write(next);
      }
      notify(next);
      return true;
    },
    hasPendingWrite() {
      return pendingWrite;
    },
    markSynced() {
      pendingWrite = false;
    },
  };

  // `storage` fires only in the documents that did not make the write, which is
  // exactly the cross-tab case: another tab's rail should follow this one.
  subscribeToStorage(key, (newValue) => {
    cached = newValue === null ? defaults() : (decodeRaw(newValue) ?? defaults());
    pendingWrite = false;
    notify(cached);
  });

  return store;
}
