import { act, renderHook } from '@testing-library/react';
import { useIconSearchPagination } from '../../../hooks/useIconSearchPagination.hook';

function setup(names: string[], query = '', pageSize = 3) {
  const scrollContainerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  return renderHook(
    ({ currentQuery }: { currentQuery: string }) =>
      useIconSearchPagination({
        names,
        query: currentQuery,
        resetKey: 'icons',
        pageSize,
        scrollContainerRef,
        // No IntersectionObserver in this environment: the slice and the
        // filtering behavior are what is under test here.
        enabled: false,
      }),
    { initialProps: { currentQuery: query } }
  );
}

describe('useIconSearchPagination', () => {
  const names = ['airplane', 'alarm', 'archive', 'arrow-up'];

  it('shows the first page before filtering', () => {
    const { result } = setup(names);

    expect(result.current.displayed).toEqual(['airplane', 'alarm', 'archive']);
    expect(result.current.hasMore).toBe(true);
  });

  it('filters glyphs case-insensitively without touching the source order', () => {
    const { result } = setup(names, 'AR');

    expect(result.current.matches).toEqual(['alarm', 'archive', 'arrow-up']);
  });

  it('matches a direct glyph slug', () => {
    const { result } = setup(names, 'airplane');

    expect(result.current.matches).toEqual(['airplane']);
    expect(result.current.hasMore).toBe(false);
  });

  it('resets to the first page when the query changes', () => {
    const { result, rerender } = setup([...names, 'anchor', 'apple', 'award'], '', 3);

    // More than one page: hasMore is true on the first page.
    expect(result.current.hasMore).toBe(true);

    rerender({ currentQuery: 'anchor' });

    expect(result.current.displayed).toEqual(['anchor']);
    expect(result.current.hasMore).toBe(false);
  });

  it('reveals the next page when the sentinel intersects, and stops at the last one', () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const observerNodes: (Element | null)[] = [];
    const OriginalIO = window.IntersectionObserver;
    window.IntersectionObserver = jest
      .fn()
      .mockImplementation((cb: IntersectionObserverCallback) => {
        callbacks.push(cb);
        return {
          observe: (node: Element) => observerNodes.push(node),
          disconnect: jest.fn(),
          unobserve: jest.fn(),
        };
      }) as unknown as typeof IntersectionObserver;

    const scrollContainerRef = { current: null } as React.RefObject<HTMLDivElement | null>;

    try {
      const { result } = renderHook(() =>
        useIconSearchPagination({
          names: ['a-1', 'a-2', 'a-3', 'a-4'],
          query: '',
          resetKey: 'icons',
          pageSize: 3,
          scrollContainerRef,
          enabled: true,
        })
      );

      expect(result.current.displayed).toHaveLength(3);

      // The panel places the sentinel the hook hands back, and only then is
      // there anything to observe: the node arrives through the callback ref.
      const sentinel = document.createElement('div');
      act(() => result.current.sentinelRef(sentinel));
      expect(observerNodes).toEqual([sentinel]);

      act(() => {
        callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], null as never);
      });

      expect(result.current.displayed).toHaveLength(4);
      expect(result.current.hasMore).toBe(false);
    } finally {
      window.IntersectionObserver = OriginalIO;
    }
  });

  it('offers a manual load for environments without an IntersectionObserver', () => {
    // The hook falls back to `loadMore` when it cannot observe: the catalog
    // must never be stranded behind a control the browser cannot fire.
    const scrollContainerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const { result } = renderHook(() =>
      useIconSearchPagination({
        names: ['a-1', 'a-2', 'a-3', 'a-4'],
        query: '',
        resetKey: 'icons',
        pageSize: 3,
        scrollContainerRef,
        enabled: true,
      })
    );

    expect(result.current.isSentinelSupported).toBe(false);

    act(() => result.current.loadMore());

    expect(result.current.displayed).toEqual(['a-1', 'a-2', 'a-3', 'a-4']);
    expect(result.current.hasMore).toBe(false);
  });

  describe('with categories', () => {
    const categories = [
      { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
      { id: 'more', label: 'More', icons: ['archive', 'arrow-up'] },
    ];

    function setupSections(query = '', pageSize = 3) {
      const scrollContainerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
      return renderHook(
        ({ currentQuery }: { currentQuery: string }) =>
          useIconSearchPagination({
            names: [],
            categories,
            query: currentQuery,
            resetKey: 'icons:all',
            pageSize,
            scrollContainerRef,
            enabled: false,
          }),
        { initialProps: { currentQuery: query } }
      );
    }

    it('keeps catalog order across sections for the flat matches', () => {
      const { result } = setupSections();

      expect(result.current.matches).toEqual(['airplane', 'alarm', 'archive', 'arrow-up']);
    });

    it('regroups only the visible slice, so later sections stay hidden until paged in', () => {
      const { result } = setupSections('', 3);

      expect(result.current.displayed).toEqual(['airplane', 'alarm', 'archive']);
      expect(result.current.sections).toEqual([
        { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
        { id: 'more', label: 'More', icons: ['archive'] },
      ]);
      expect(result.current.hasMore).toBe(true);
    });

    it('filters within sections and drops emptied ones', () => {
      const { result } = setupSections('ar');

      expect(result.current.matches).toEqual(['alarm', 'archive', 'arrow-up']);
      expect(result.current.sections).toEqual([
        { id: 'essentials', label: 'Essentials', icons: ['alarm'] },
        { id: 'more', label: 'More', icons: ['archive', 'arrow-up'] },
      ]);
    });

    it('returns no sections on the flat path', () => {
      const { result } = setup(['airplane', 'alarm']);

      expect(result.current.sections).toEqual([]);
    });
  });
});
