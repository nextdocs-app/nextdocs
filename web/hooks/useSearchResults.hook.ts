'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api-client';
import { DEFAULT_SEARCH_LIMIT, searchService } from '@/services/search.service';
import type { SearchHit } from '@/types/search.types';

export type SearchMode = 'recent' | 'search' | 'offline' | 'guest';

/** A message that only applies to the query it was produced for. */
interface QueryScopedMessage {
  query: string;
  message: string;
}

const SEARCH_DEBOUNCE_MS = 180;
/** A search that never settles must not leave the skeletons up forever. */
const SEARCH_TIMEOUT_MS = 10_000;

export interface SearchResultsState {
  hits: SearchHit[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  /**
   * A paging failure only. Kept apart from `errorMessage` so a failed next page cannot
   * replace results the user already has on screen.
   */
  loadMoreError: string | null;
  errorMessage: string | null;
  fallbackNotice: string | null;
  mode: SearchMode;
  loadMore: () => Promise<void>;
  retry: () => void;
}

/**
 * Owns the remote search lifecycle for the quick-search dialog: debounce,
 * cancellation, pagination, and the query-scoped error/fallback messages.
 *
 * Everything the caller renders is derived from the current query, so a stale
 * response or a message from a previous query can never surface: `hits` count
 * as current only when `resultsQuery` matches, and errors/fallbacks carry the
 * query they were produced for.
 */
export function useSearchResults({
  query,
  accessToken,
  isAuthenticated,
  isOnline,
}: {
  query: string;
  accessToken: string | null;
  isAuthenticated: boolean;
  isOnline: boolean;
}): SearchResultsState {
  const trimmedQuery = query.trim();
  const canUseRemoteSearch = Boolean(isAuthenticated && accessToken && isOnline);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [resultsQuery, setResultsQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<QueryScopedMessage | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<QueryScopedMessage | null>(null);
  const [fallback, setFallback] = useState<QueryScopedMessage | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const errorMessage = error && error.query === trimmedQuery ? error.message : null;
  const loadMoreErrorMessage =
    loadMoreError && loadMoreError.query === trimmedQuery ? loadMoreError.message : null;
  const fallbackNotice = fallback && fallback.query === trimmedQuery ? fallback.message : null;

  const mode: SearchMode = !trimmedQuery
    ? 'recent'
    : !isAuthenticated || !accessToken
      ? 'guest'
      : !isOnline || fallbackNotice
        ? 'offline'
        : 'search';

  const resultsAreCurrent = resultsQuery === trimmedQuery;
  const isLoading = mode === 'search' && !resultsAreCurrent && !errorMessage;

  const settleWithFallback = useCallback(
    (message: string) => {
      setFallback({ query: trimmedQuery, message });
      setHits([]);
      setResultsQuery(trimmedQuery);
      setHasMore(false);
    },
    [trimmedQuery]
  );

  useEffect(() => {
    abortControllerRef.current?.abort();

    if (!trimmedQuery || !canUseRemoteSearch || !accessToken) {
      return;
    }

    const requestId = ++requestSeqRef.current;

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      let timedOut = false;
      const timeoutTimer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SEARCH_TIMEOUT_MS);

      const run = async () => {
        // A new query owns the list: a pending "load more" and its failure belong to the old
        // one, so neither may survive into the new result set.
        setIsLoadingMore(false);
        setLoadMoreError(null);

        try {
          const response = await searchService.search(accessToken, trimmedQuery, {
            limit: DEFAULT_SEARCH_LIMIT,
            offset: 0,
            signal: controller.signal,
          });
          if (controller.signal.aborted || requestSeqRef.current !== requestId) {
            return;
          }
          setHits(response.items);
          setResultsQuery(trimmedQuery);
          setHasMore(response.hasMore);
          setNextOffset(response.nextOffset);
        } catch (requestError) {
          if (requestSeqRef.current !== requestId) {
            return;
          }
          if (timedOut) {
            setError({
              query: trimmedQuery,
              message: 'Search is taking too long. Check your connection and try again.',
            });
            return;
          }
          if (controller.signal.aborted) {
            return;
          }
          if (requestError instanceof DOMException && requestError.name === 'AbortError') {
            return;
          }
          if (requestError instanceof ApiError && requestError.status === 404) {
            settleWithFallback('Full-text search is unavailable — showing matching titles.');
            return;
          }
          if (requestError instanceof TypeError) {
            settleWithFallback('Offline — showing matching titles on this device.');
            return;
          }
          setError({
            query: trimmedQuery,
            message:
              requestError instanceof Error
                ? requestError.message
                : 'Unable to search documents right now.',
          });
        } finally {
          window.clearTimeout(timeoutTimer);
        }
      };

      void run();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      abortControllerRef.current?.abort();
    };
  }, [trimmedQuery, canUseRemoteSearch, accessToken, retryNonce, settleWithFallback]);

  const loadMore = useCallback(async () => {
    if (
      !accessToken ||
      !canUseRemoteSearch ||
      !trimmedQuery ||
      !hasMore ||
      isLoading ||
      isLoadingMore ||
      !resultsAreCurrent
    ) {
      return;
    }

    const requestId = requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoadingMore(true);

    try {
      const response = await searchService.search(accessToken, trimmedQuery, {
        limit: DEFAULT_SEARCH_LIMIT,
        offset: nextOffset,
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestSeqRef.current !== requestId) {
        return;
      }
      setHits((previous) => {
        const seen = new Set(previous.map((item) => item.documentId));
        const appended = response.items.filter((item) => !seen.has(item.documentId));
        return [...previous, ...appended];
      });
      setHasMore(response.hasMore);
      setNextOffset(response.nextOffset);
      setLoadMoreError(null);
    } catch (requestError) {
      if (controller.signal.aborted || requestSeqRef.current !== requestId) {
        return;
      }
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        return;
      }
      // A failed next page is not a failed search: report it where the paging control is
      // and keep the results the user already has.
      setLoadMoreError({
        query: trimmedQuery,
        message:
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load more search results.',
      });
    } finally {
      // Always settle: an aborted page has no other owner to clear the flag.
      setIsLoadingMore(false);
    }
  }, [
    accessToken,
    canUseRemoteSearch,
    trimmedQuery,
    hasMore,
    isLoading,
    isLoadingMore,
    resultsAreCurrent,
    nextOffset,
  ]);

  const retry = useCallback(() => {
    setError(null);
    setLoadMoreError(null);
    setRetryNonce((value) => value + 1);
  }, []);

  return {
    hits,
    hasMore: resultsAreCurrent ? hasMore : false,
    isLoading,
    isLoadingMore,
    loadMoreError: loadMoreErrorMessage,
    errorMessage,
    fallbackNotice,
    mode,
    loadMore,
    retry,
  };
}
