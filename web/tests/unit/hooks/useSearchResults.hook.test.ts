import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchResults } from '../../../hooks/useSearchResults.hook';
import { ApiError } from '../../../services/api-client';
import { searchService } from '../../../services/search.service';

jest.mock('../../../services/search.service', () => ({
  DEFAULT_SEARCH_LIMIT: 20,
  MAX_SEARCH_QUERY_LENGTH: 200,
  searchService: {
    search: jest.fn(),
  },
}));

const hit = (documentId: string) => ({
  documentId,
  title: [{ text: documentId, match: false }],
  snippet: [],
  breadcrumb: [],
  space: null,
  icon: null,
  updatedAt: null,
});

function setup(query: string) {
  return renderHook(
    ({ currentQuery }: { currentQuery: string }) =>
      useSearchResults({
        query: currentQuery,
        accessToken: 'token-1',
        isAuthenticated: true,
        isOnline: true,
      }),
    { initialProps: { currentQuery: query } }
  );
}

describe('useSearchResults', () => {
  beforeEach(() => {
    // reset, not clear: a leftover one-shot response from the previous test would answer
    // the next test's first request.
    jest.resetAllMocks();
  });

  it('hides results that belong to a previous query until the new one settles', async () => {
    (searchService.search as jest.Mock)
      .mockResolvedValueOnce({
        query: 'a',
        items: [hit('a-1')],
        hasMore: false,
        nextOffset: 1,
      })
      .mockReturnValueOnce(new Promise(() => {}));

    const { result, rerender } = setup('a');
    await waitFor(() => expect(result.current.hits).toHaveLength(1));

    rerender({ currentQuery: 'ab' });

    expect(result.current.hits).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it('clears an earlier fallback when the same query later succeeds', async () => {
    (searchService.search as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Not Found', 404))
      .mockResolvedValueOnce({
        query: 'docs',
        items: [hit('docs-1')],
        hasMore: false,
        nextOffset: 1,
      });

    const { result } = setup('docs');

    await waitFor(() => expect(result.current.mode).toBe('offline'));
    expect(result.current.fallbackNotice).toMatch(/unavailable/i);

    act(() => result.current.retry());

    // The retry proves server search works again: the old fallback must not keep the
    // fresh hits behind the offline view.
    await waitFor(() => expect(result.current.mode).toBe('search'));
    expect(result.current.hits).toEqual([hit('docs-1')]);
    expect(result.current.fallbackNotice).toBeNull();
  });

  it('fails a load-more that never settles and allows another attempt', async () => {
    (searchService.search as jest.Mock)
      .mockResolvedValueOnce({
        query: 'sync',
        items: [hit('sync-1')],
        hasMore: true,
        nextOffset: 1,
      })
      .mockImplementationOnce(
        (_token: string, _query: string, options: { signal?: AbortSignal }): Promise<never> =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      );

    const { result } = setup('sync');
    await waitFor(() => expect(result.current.hits).toHaveLength(1));

    jest.useFakeTimers();
    try {
      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = result.current.loadMore();
      });
      expect(result.current.isLoadingMore).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      await pending;

      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.loadMoreError).toMatch(/taking too long/i);
      // The rows above the paging control survive the failed page.
      expect(result.current.hits).toHaveLength(1);

      (searchService.search as jest.Mock).mockResolvedValueOnce({
        query: 'sync',
        items: [hit('sync-2')],
        hasMore: false,
        nextOffset: 2,
      });
      await act(async () => {
        await result.current.loadMore();
      });

      // The timeout must release the flag, or the paging control could never retry.
      expect(result.current.hits).toHaveLength(2);
      expect(result.current.loadMoreError).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
