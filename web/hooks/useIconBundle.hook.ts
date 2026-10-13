'use client';

import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-url.util';
import { isWellFormedBuiltinSlug } from '@/lib/document-icon.util';
import { parseApiEnvelope } from '@/services/api-envelope';

export type IconBundle = Map<string, string>;

interface IconBundlePayload {
  icons: Record<string, unknown>;
}

export const ICON_BUNDLE_PATH = '/api/v1/icons/bundle';

const BUNDLE_TTL_MS = 24 * 60 * 60 * 1000;

let cachedBundle: { bundle: IconBundle; fetchedAt: number } | null = null;
let inflightBundle: Promise<IconBundle> | null = null;

/** Test hook: the module-level cache must not leak between test files. */
export function resetIconBundleCache(): void {
  cachedBundle = null;
  inflightBundle = null;
}

/**
 * Both halves of the bundle are untrusted: the glyph text ends up in a data URL,
 * and the slug keys address the glyph endpoints, so each gets the same validation
 * a slug or icon value gets anywhere else.
 */
function sanitizeBundle(raw: unknown): IconBundle {
  const bundle: IconBundle = new Map();
  if (typeof raw !== 'object' || raw === null) {
    return bundle;
  }
  for (const [slug, svg] of Object.entries(raw as Record<string, unknown>)) {
    if (!isWellFormedBuiltinSlug(slug) || typeof svg !== 'string') {
      continue;
    }
    const text = svg.trim();
    if (text.startsWith('<svg') && text.endsWith('</svg>')) {
      bundle.set(slug, text);
    }
  }
  return bundle;
}

function fetchIconBundle(): Promise<IconBundle> {
  const cached = cachedBundle;
  if (cached && Date.now() - cached.fetchedAt < BUNDLE_TTL_MS) {
    return Promise.resolve(cached.bundle);
  }
  if (inflightBundle) {
    return inflightBundle;
  }

  const request = (async () => {
    const response = await fetch(`${getApiBaseUrl()}${ICON_BUNDLE_PATH}`, { method: 'GET' });
    const body = await parseApiEnvelope<IconBundlePayload>(response);
    const icons = body?.data?.icons;
    if (!response.ok || !body?.success || typeof icons !== 'object' || icons === null) {
      throw new Error(body?.message || body?.error || 'Failed to load the icon bundle.');
    }
    return sanitizeBundle(icons);
  })();

  inflightBundle = request
    .then((bundle) => {
      cachedBundle = { bundle, fetchedAt: Date.now() };
      return bundle;
    })
    .finally(() => {
      inflightBundle = null;
    });

  return inflightBundle;
}

/**
 * Every builtin glyph in one request, so the picker grid renders without one
 * HTTP request per icon. Fetched once per session and shared by every picker;
 * `enabled` keeps the request from firing until a picker actually shows the
 * catalog. On failure the picker falls back to per-glyph URLs, so a bundle
 * error degrades instead of bricking the grid.
 */
export function useIconBundle(enabled: boolean): {
  bundle: IconBundle | null;
  isLoading: boolean;
  error: string | null;
} {
  // Defensive copies: the module cache owns its Map, so hooks hand out copies.
  // Handing out the cached reference would let one accidental mutation corrupt
  // every later picker.
  const [bundle, setBundle] = useState<IconBundle | null>(() =>
    cachedBundle ? new Map(cachedBundle.bundle) : null
  );
  const [hasLoaded, setHasLoaded] = useState(() => cachedBundle !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    fetchIconBundle()
      .then((next) => {
        if (!cancelled) {
          setBundle(new Map(next));
          setHasLoaded(true);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('Failed to load the builtin icon bundle:', err);
          setError(err instanceof Error ? err.message : 'Failed to load icons.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Derived rather than stored: a set-state on entry to the effect would be a
  // cascading render for a value React can compute from what it already knows.
  const isLoading = enabled && !hasLoaded && error === null;

  return { bundle, isLoading, error };
}
