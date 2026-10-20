/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const ORIGIN = 'https://nextdocs.test';
const workerSource = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

class FakeRequest {
  url: string;
  method: string;
  mode: string;

  constructor(input: string | { url: string }, init: { method?: string; mode?: string } = {}) {
    const raw = typeof input === 'string' ? input : input.url;
    this.url = new URL(raw, ORIGIN).href;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
  }
}

class FakeResponse {
  ok: boolean;
  type: string;
  status: number;
  headers: Record<string, string>;
  private body: string;

  constructor(
    body = '',
    init: { status?: number; type?: string; headers?: Record<string, string> } = {}
  ) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.type = init.type ?? 'basic';
    this.headers = init.headers ?? {};
  }

  clone(): FakeResponse {
    return new FakeResponse(this.body, {
      status: this.status,
      type: this.type,
      headers: this.headers,
    });
  }

  async text(): Promise<string> {
    return this.body;
  }
}

class FakeCache {
  private entries = new Map<string, FakeResponse>();

  async add(request: FakeRequest): Promise<void> {
    const response = await fetchMock(request);
    if (!response.ok) {
      throw new Error(`Precache failed for ${request.url}`);
    }
    this.entries.set(request.url, response.clone());
  }

  async put(request: FakeRequest, response: FakeResponse): Promise<void> {
    this.entries.set(request.url, response.clone());
  }

  async keys(): Promise<FakeRequest[]> {
    return [...this.entries.keys()].map((url) => new FakeRequest(url));
  }

  async delete(request: FakeRequest): Promise<boolean> {
    return this.entries.delete(this.key(request));
  }

  async match(
    request: FakeRequest | string,
    options: { ignoreSearch?: boolean } = {}
  ): Promise<FakeResponse | undefined> {
    const key = this.key(request);
    if (this.entries.has(key)) {
      return this.entries.get(key);
    }
    if (options.ignoreSearch) {
      const path = key.split('?')[0];
      for (const [cachedKey, response] of this.entries) {
        if (cachedKey.split('?')[0] === path) {
          return response;
        }
      }
    }
    return undefined;
  }

  private key(request: FakeRequest | string): string {
    const raw = typeof request === 'string' ? request : request.url;
    return new URL(raw, ORIGIN).href;
  }
}

interface WorkerHarness {
  listeners: Map<string, (event: Record<string, unknown>) => void>;
  caches: Map<string, FakeCache>;
  deleted: string[];
  fetchMock: jest.Mock;
  claim: jest.Mock;
  dispatch: (type: string, event: Record<string, unknown>) => Promise<unknown[]>;
}

const fetchMock = jest.fn();

function createWorker(): WorkerHarness {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const caches = new Map<string, FakeCache>();
  const deleted: string[] = [];
  const claim = jest.fn().mockResolvedValue(undefined);

  const worker = {
    listeners,
    caches,
    deleted,
    fetchMock,
    claim,
    dispatch: async (type: string, event: Record<string, unknown>) => {
      const listener = listeners.get(type);
      if (!listener) {
        throw new Error(`No ${type} listener registered`);
      }
      const pending: Promise<unknown>[] = [];
      listener({
        ...event,
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });
      return Promise.all(pending);
    },
  };

  const context = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.set(type, listener);
      },
      clients: { claim },
    },
    caches: {
      open: async (name: string) => {
        if (!caches.has(name)) {
          caches.set(name, new FakeCache());
        }
        return caches.get(name);
      },
      keys: async () => [...caches.keys()],
      delete: async (name: string) => {
        deleted.push(name);
        return caches.delete(name);
      },
    },
    fetch: fetchMock,
    Request: FakeRequest,
    Response: FakeResponse,
    URL,
    Set,
    Promise,
  };

  vm.runInNewContext(workerSource, context);

  return worker;
}

function fetchEvent(request: FakeRequest) {
  return {
    request,
    respondWith: jest.fn(),
  };
}

describe('service worker', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('precaches the shell and assets without aborting on a failed asset', async () => {
    fetchMock.mockImplementation(async (request: FakeRequest) => {
      if (request.url.endsWith('/icons/icon-512.png')) {
        throw new Error('asset unavailable');
      }
      if (request.url === `${ORIGIN}/`) {
        return new FakeResponse('<html><script src="/_next/static/chunks/app.js"></script></html>');
      }
      return new FakeResponse('precached');
    });
    const worker = createWorker();

    await worker.dispatch('install', {});

    const pageCache = worker.caches.get('nextdocs-v5-pages');
    const assetCache = worker.caches.get('nextdocs-v5-assets');
    expect(await pageCache?.match('/')).toBeDefined();
    expect(await pageCache?.match('/offline')).toBeDefined();
    expect(await pageCache?.match('/manifest.webmanifest')).toBeDefined();
    expect(await assetCache?.match('/icons/icon-192.png')).toBeDefined();
    expect(await assetCache?.match('/_next/static/chunks/app.js')).toBeDefined();
    expect(await assetCache?.match('/icons/icon-512.png')).toBeUndefined();
  });

  it('drops old nextdocs caches on activate but leaves other apps alone', async () => {
    const worker = createWorker();
    await worker.caches.set('nextdocs-v3-pages', new FakeCache());
    await worker.caches.set('nextdocs-v5-pages', new FakeCache());
    await worker.caches.set('other-app-cache', new FakeCache());

    await worker.dispatch('activate', {});

    expect(worker.deleted).toContain('nextdocs-v3-pages');
    expect(worker.deleted).not.toContain('nextdocs-v5-pages');
    expect(worker.deleted).not.toContain('other-app-cache');
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });

  it('serves navigations from the network and caches the fresh shell', async () => {
    fetchMock.mockResolvedValue(new FakeResponse('fresh page'));
    const worker = createWorker();
    const request = new FakeRequest('/doc/1', { mode: 'navigate' });
    const event = fetchEvent(request);

    worker.listeners.get('fetch')?.(event);

    await expect(event.respondWith.mock.calls[0][0]).resolves.toMatchObject({
      ok: true,
    });
    const pageCache = worker.caches.get('nextdocs-v5-pages');
    expect(await pageCache?.match(request)).toBeDefined();
  });

  it('evicts the oldest cached pages once the page cache is full', async () => {
    fetchMock.mockResolvedValue(new FakeResponse('page'));
    const worker = createWorker();

    for (let index = 0; index < 51; index += 1) {
      const event = fetchEvent(new FakeRequest(`/doc/${index}`, { mode: 'navigate' }));
      worker.listeners.get('fetch')?.(event);
      await event.respondWith.mock.calls[0][0];
    }

    const pageCache = worker.caches.get('nextdocs-v5-pages');
    expect(await pageCache?.keys()).toHaveLength(50);
    expect(await pageCache?.match('/doc/0')).toBeUndefined();
    expect(await pageCache?.match('/doc/50')).toBeDefined();
  });

  it('falls back to a cached page with the same path when the network fails', async () => {
    const worker = createWorker();
    const pageCache = new FakeCache();
    worker.caches.set('nextdocs-v5-pages', pageCache);
    await pageCache.put(new FakeRequest('/doc/1'), new FakeResponse('cached page'));

    fetchMock.mockRejectedValue(new Error('offline'));
    const event = fetchEvent(new FakeRequest('/doc/1?tab=comments', { mode: 'navigate' }));

    worker.listeners.get('fetch')?.(event);

    await expect(event.respondWith.mock.calls[0][0]).resolves.toMatchObject({
      ok: true,
    });
    const response = await event.respondWith.mock.calls[0][0];
    await expect(response.text()).resolves.toBe('cached page');
  });

  it('serves the offline page when neither the network nor the route is cached', async () => {
    const worker = createWorker();
    const pageCache = new FakeCache();
    worker.caches.set('nextdocs-v5-pages', pageCache);
    await pageCache.put(new FakeRequest('/offline'), new FakeResponse('offline page'));

    fetchMock.mockRejectedValue(new Error('offline'));
    const event = fetchEvent(new FakeRequest('/doc/uncached', { mode: 'navigate' }));

    worker.listeners.get('fetch')?.(event);

    const response = await event.respondWith.mock.calls[0][0];
    await expect(response.text()).resolves.toBe('offline page');
  });

  it('never caches API, share, or HMR requests', async () => {
    const worker = createWorker();
    const paths = ['/api/v1/documents', '/share/secret-token', '/_next/webpack-hmr'];

    for (const path of paths) {
      const event = fetchEvent(new FakeRequest(path));
      worker.listeners.get('fetch')?.(event);
      expect(event.respondWith).not.toHaveBeenCalled();
    }

    const crossOrigin = fetchEvent(new FakeRequest('https://elsewhere.test/app.js'));
    worker.listeners.get('fetch')?.(crossOrigin);
    expect(crossOrigin.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches static assets on first use and serves them from cache afterwards', async () => {
    fetchMock.mockResolvedValue(new FakeResponse('asset bytes'));
    const worker = createWorker();
    const request = new FakeRequest('/icons/icon-192.png');
    const first = fetchEvent(request);

    worker.listeners.get('fetch')?.(first);
    const firstResponse = await first.respondWith.mock.calls[0][0];
    await expect(firstResponse.text()).resolves.toBe('asset bytes');

    fetchMock.mockClear();
    const second = fetchEvent(request);
    worker.listeners.get('fetch')?.(second);
    const secondResponse = await second.respondWith.mock.calls[0][0];

    await expect(secondResponse.text()).resolves.toBe('asset bytes');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches same-origin pages announced by in-app navigation', async () => {
    fetchMock.mockResolvedValue(new FakeResponse('navigated page'));
    const worker = createWorker();
    const event: Record<string, unknown> = {
      data: { type: 'CACHE_PAGE', url: `${ORIGIN}/doc/42` },
    };

    await worker.dispatch('message', event);

    const pageCache = worker.caches.get('nextdocs-v5-pages');
    expect(await pageCache?.match('/doc/42')).toBeDefined();

    fetchMock.mockClear();
    await worker.dispatch('message', {
      data: { type: 'CACHE_PAGE', url: `${ORIGIN}/share/secret` },
    });
    await worker.dispatch('message', {
      data: { type: 'CACHE_PAGE', url: 'https://elsewhere.test/doc/42' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
