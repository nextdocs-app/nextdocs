import { sanitizeDocumentIcon } from '@/lib/document-icon.util';
import { apiRequest } from '@/services/api-client';
import type {
  SearchBreadcrumb,
  SearchHit,
  SearchResponse,
  SearchSpace,
  SearchTextSegment,
} from '@/types/search.types';

const SEARCH_PATH = '/api/v1/search';

/**
 * Mirrors the API's `SEARCH_MAX_QUERY_LENGTH` default and caps only the input. A lower
 * server value still answers a 400, which the dialog shows verbatim rather than silently
 * truncating the query.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const DEFAULT_SEARCH_LIMIT = 20;

interface RawSearchResponse {
  query?: string;
  items?: unknown[] | null;
  hasMore?: boolean;
  nextOffset?: number;
}

/**
 * Highlight segments reach the DOM as text, so a malformed entry is dropped
 * rather than rendered: a single non-object would otherwise crash the row.
 */
function normalizeSegments(raw: unknown): SearchTextSegment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((segment): SearchTextSegment[] => {
    if (segment === null || typeof segment !== 'object') {
      return [];
    }
    const { text, match } = segment as { text?: unknown; match?: unknown };
    return typeof text === 'string' ? [{ text, match: match === true }] : [];
  });
}

function normalizeBreadcrumb(raw: unknown): SearchBreadcrumb[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((crumb): SearchBreadcrumb[] => {
    if (crumb === null || typeof crumb !== 'object') {
      return [];
    }
    const { id, title } = crumb as { id?: unknown; title?: unknown };
    return typeof id === 'string'
      ? [{ id, title: typeof title === 'string' ? title : 'Untitled' }]
      : [];
  });
}

function normalizeSpace(raw: unknown): SearchSpace | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const { id, name } = raw as { id?: unknown; name?: unknown };
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
}

function normalizeHit(raw: unknown): SearchHit | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const hit = raw as Record<string, unknown>;
  if (typeof hit.documentId !== 'string' || hit.documentId.length === 0) {
    return null;
  }
  return {
    documentId: hit.documentId,
    title: normalizeSegments(hit.title),
    snippet: normalizeSegments(hit.snippet),
    breadcrumb: normalizeBreadcrumb(hit.breadcrumb),
    space: normalizeSpace(hit.space),
    icon: sanitizeDocumentIcon(hit.icon) ?? null,
    updatedAt: typeof hit.updatedAt === 'string' ? hit.updatedAt : null,
  };
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

export const searchService = {
  /** Full-text search across document titles and body content (accepts >= 1 char). */
  async search(
    accessToken: string,
    query: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {}
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const raw = await apiRequest<RawSearchResponse>(`${SEARCH_PATH}?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal: options.signal,
    });

    const items = Array.isArray(raw.items)
      ? raw.items.map(normalizeHit).filter((hit): hit is SearchHit => hit !== null)
      : [];

    return {
      query: typeof raw.query === 'string' ? raw.query : query,
      items,
      hasMore: Boolean(raw.hasMore),
      // Fall back to the next page start, not the page size: a request at offset 40 that
      // dropped a malformed hit must not re-fetch rows it already has.
      nextOffset:
        typeof raw.nextOffset === 'number' && Number.isFinite(raw.nextOffset)
          ? raw.nextOffset
          : (options.offset ?? 0) + items.length,
    };
  },
};
