'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Registers the PWA service worker.
 *
 * Production only: the worker caches build output, which would fight HMR and
 * pin stale chunks during local development.
 */
export function ServiceWorkerRegistrar() {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('[NextDocs] Service worker registration failed:', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  // In-app navigation fetches only an RSC payload, so the worker never sees a
  // navigation request for the new URL. Tell it to cache the page explicitly;
  // otherwise reloading a document offline lands on /offline.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const postCurrentPage = (worker: ServiceWorker | null) => {
      worker?.postMessage({ type: 'CACHE_PAGE', url: window.location.href });
    };

    const onControllerChange = () => {
      postCurrentPage(navigator.serviceWorker.controller);
    };

    const cacheCurrentPage = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (cancelled) return;
        postCurrentPage(navigator.serviceWorker.controller ?? registration.active);
      } catch {
        // The app still works online if the worker cannot be reached.
      }
    };

    // A newly activated worker has no document routes cached; re-prime the
    // page the user is on instead of waiting for the next navigation.
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void cacheCurrentPage();

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [pathname]);

  return null;
}
