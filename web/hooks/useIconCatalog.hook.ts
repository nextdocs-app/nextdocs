'use client';

import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-url.util';
import { isWellFormedBuiltinSlug } from '@/lib/document-icon.util';
import { parseApiEnvelope } from '@/services/api-envelope';

export interface IconCatalogCategory {
  id: string;
  label: string;
  icons: string[];
}

export interface IconCatalog {
  names: string[];
  categories: IconCatalogCategory[];
  source: string;
  license: string;
}

export const ICON_CATALOG_PATH = '/api/v1/icons';

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

let cachedCatalog: { catalog: IconCatalog; fetchedAt: number } | null = null;
let inflightCatalog: Promise<IconCatalog> | null = null;

/** Test hook: the module-level cache must not leak between test files. */
export function resetIconCatalogCache(): void {
  cachedCatalog = null;
  inflightCatalog = null;
}

/** Category entries arrive with the icon names, so they get the same distrust. */
function sanitizeCategories(raw: unknown): IconCatalogCategory[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const sections: IconCatalogCategory[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { id, label, icons } = entry as { id?: unknown; label?: unknown; icons?: unknown };
    if (!isWellFormedBuiltinSlug(id) || typeof label !== 'string' || !label.trim()) {
      continue;
    }
    if (!Array.isArray(icons)) {
      continue;
    }
    const slugs = (icons as unknown[]).filter((icon): icon is string =>
      isWellFormedBuiltinSlug(icon)
    );
    if (slugs.length === 0) {
      continue;
    }
    sections.push({ id, label: label.trim(), icons: [...slugs] });
  }
  return sections;
}

/** Catalog names address glyph files, so malformed entries never reach the grid. */
function sanitizeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((name): name is string => isWellFormedBuiltinSlug(name));
}

function fetchIconCatalog(): Promise<IconCatalog> {
  const cached = cachedCatalog;
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
    return Promise.resolve(cached.catalog);
  }
  if (inflightCatalog) {
    return inflightCatalog;
  }

  const request = (async () => {
    const response = await fetch(`${getApiBaseUrl()}${ICON_CATALOG_PATH}`, { method: 'GET' });
    const body = await parseApiEnvelope<IconCatalog>(response);
    const names = body?.data?.names;
    if (!response.ok || !body?.success || !Array.isArray(names)) {
      throw new Error(body?.message || body?.error || 'Failed to load the icon catalog.');
    }
    return {
      names: sanitizeNames(names),
      // Older servers send no categories: the picker falls back to the flat
      // grid, so a missing or malformed value reads as empty, never an error.
      categories: sanitizeCategories(body?.data?.categories),
      source: body.data?.source ?? '',
      license: body.data?.license ?? '',
    };
  })();

  inflightCatalog = request
    .then((catalog) => {
      cachedCatalog = { catalog, fetchedAt: Date.now() };
      return catalog;
    })
    .finally(() => {
      inflightCatalog = null;
    });

  return inflightCatalog;
}

/**
 * Builtin page-icon slugs. The catalog is immutable and public, so it is fetched
 * once per session and shared by every picker; `enabled` keeps the request from
 * firing until a picker actually shows the catalog.
 */
export function useIconCatalog(enabled: boolean): {
  names: string[];
  categories: IconCatalogCategory[];
  isLoading: boolean;
  error: string | null;
} {
  // Defensive copies: the module cache owns its arrays, so hooks hand out
  // copies to keep one consumer from corrupting the next.
  const [names, setNames] = useState<string[]>(() => [...(cachedCatalog?.catalog.names ?? [])]);
  const [categories, setCategories] = useState<IconCatalogCategory[]>(
    () => cachedCatalog?.catalog.categories.map((c) => ({ ...c, icons: [...c.icons] })) ?? []
  );
  const [hasLoaded, setHasLoaded] = useState(() => cachedCatalog !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    fetchIconCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setNames([...catalog.names]);
          setCategories(catalog.categories.map((c) => ({ ...c, icons: [...c.icons] })));
          setHasLoaded(true);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('Failed to load the builtin icon catalog:', err);
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

  return { names, categories, isLoading, error };
}
