/*
 * NextDocs service worker.
 *
 * Bump VERSION whenever the precache list or caching strategy changes so old
 * caches are dropped on activate. Hashed `/_next/static` assets are immutable,
 * so they are precached with the shell and reused across deployments.
 *
 * Updates deliberately do not call skipWaiting: the new worker activates on the
 * next launch, so a tab open across a deploy never asks for a chunk from the
 * build the new worker just deleted.
 */
const VERSION = 'nextdocs-v4';
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;
const CACHE_NAMES = new Set([PAGE_CACHE, ASSET_CACHE]);

const PAGE_PRECACHE_URLS = ['/', '/offline', '/manifest.webmanifest'];
const ASSET_PRECACHE_URLS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

// Routes that must never be written to the cache: authenticated API traffic,
// realtime upgrades, and share links (they can carry one-off access tokens).
function isUncacheablePath(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/share/') ||
    pathname.startsWith('/_next/webpack-hmr')
  );
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/_next/image') ||
    pathname.startsWith('/icons/') ||
    /\.(?:css|js|mjs|woff2?|ttf|otf|png|svg|ico|webp|avif|jpg|jpeg|gif)$/.test(pathname)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const pageCache = await caches.open(PAGE_CACHE);
      const assetCache = await caches.open(ASSET_CACHE);

      // Add entries individually: one failed request must not abort the whole
      // install (and leave the app without a controlling worker).
      await Promise.all(
        PAGE_PRECACHE_URLS.map(async (url) => {
          try {
            await pageCache.add(new Request(url, { cache: 'reload' }));
          } catch {
            // Best effort; the runtime strategies below still cache on demand.
          }
        })
      );

      // Registration happens after window.load, so the first load's chunks and
      // CSS were fetched before this worker could see them. Read the shell HTML
      // back from the page cache and precache every build asset it references.
      const assets = new Set(ASSET_PRECACHE_URLS);
      const shell = await pageCache.match('/');
      if (shell) {
        const html = await shell.text();
        const pattern = /(?:src|href)="([^"]+)"/g;
        let match;
        while ((match = pattern.exec(html)) !== null) {
          if (match[1].startsWith('/_next/static/')) {
            assets.add(match[1]);
          }
        }
      }

      await Promise.all(
        [...assets].map(async (url) => {
          try {
            await assetCache.add(new Request(url, { cache: 'reload' }));
          } catch {
            // Best effort; the runtime strategies below still cache on demand.
          }
        })
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Without skipWaiting this worker activates only when no client still
      // uses the previous build, so its caches are safe to drop here.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('nextdocs-') && !CACHE_NAMES.has(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      // A cache write failure (e.g. quota) must not replace the live response.
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const offline = await cache.match('/offline');
    if (offline) return offline;

    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
        '<title>Offline · NextDocs</title><body style="font-family:system-ui;padding:2rem">' +
        '<h1>You are offline</h1><p>Reconnect to open this page.</p>' +
        '<p><a href="/">Open NextDocs</a></p></body>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

// Client-side navigations fetch an RSC payload, not an HTML document, so the
// worker never sees a navigation request for the new URL. The page tells us
// which URL it landed on so an offline reload can still get the shell.
async function cachePage(url) {
  const cache = await caches.open(PAGE_CACHE);
  const request = new Request(url, { cache: 'reload' });
  if (await cache.match(request, { ignoreSearch: true })) return;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone()).catch(() => {});
    }
  } catch {
    // Lost the connection before the page could be cached.
  }
}

self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data || data.type !== 'CACHE_PAGE' || typeof data.url !== 'string') return;

  let url;
  try {
    url = new URL(data.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (isUncacheablePath(url.pathname)) return;

  event.waitUntil(cachePage(url.href));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isUncacheablePath(url.pathname)) return;

  // Full page loads: never serve a stale shell when the network is available.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstAsset(request));
  }
});
