import { renderHook, waitFor } from '@testing-library/react';
import { resetIconCatalogCache, useIconCatalog } from '../../../hooks/useIconCatalog.hook';

function mockCatalogFetch(
  names: string[],
  categories: { id: string; label: string; icons: string[] }[] = []
) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { names, categories, source: 'test', license: 'test' },
      error: null,
    }),
  } as Response);
}

describe('useIconCatalog', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetIconCatalogCache();
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    resetIconCatalogCache();
  });

  it('does not fetch until a picker shows the catalog', () => {
    const fetchMock = mockCatalogFetch(['airplane']);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconCatalog(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toEqual({ names: [], categories: [], isLoading: false, error: null });
  });

  it('fetches once and shares the catalog across mounts', async () => {
    const fetchMock = mockCatalogFetch(['airplane', 'alarm']);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const first = renderHook(() => useIconCatalog(true));
    const second = renderHook(() => useIconCatalog(true));

    await waitFor(() => {
      expect(first.result.current.names).toEqual(['airplane', 'alarm']);
    });
    await waitFor(() => {
      expect(second.result.current.names).toEqual(['airplane', 'alarm']);
    });

    // Concurrent mounts coalesce into one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.result.current.isLoading).toBe(false);
  });

  it('serves the cached catalog without refetching', async () => {
    const fetchMock = mockCatalogFetch(['airplane']);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const first = renderHook(() => useIconCatalog(true));
    await waitFor(() => {
      expect(first.result.current.names).toEqual(['airplane']);
    });
    first.unmount();

    const second = renderHook(() => useIconCatalog(true));

    expect(second.result.current.names).toEqual(['airplane']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses picker sections from the catalog response', async () => {
    const sections = [
      { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
      { id: 'more', label: 'More', icons: ['archive'] },
    ];
    const fetchMock = mockCatalogFetch(['airplane', 'alarm', 'archive'], sections);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconCatalog(true));

    await waitFor(() => {
      expect(result.current.categories).toEqual(sections);
    });
  });

  it('reads missing or malformed sections as an empty list', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          names: ['airplane'],
          categories: [
            { id: 'ok', label: 'Ok', icons: ['airplane'] },
            null,
            { id: '', label: 'No id' },
          ],
          source: 'test',
          license: 'test',
        },
        error: null,
      }),
    } as Response);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconCatalog(true));

    await waitFor(() => {
      expect(result.current.names).toEqual(['airplane']);
    });
    expect(result.current.categories).toEqual([{ id: 'ok', label: 'Ok', icons: ['airplane'] }]);
  });

  it('drops malformed slugs so they never reach the grid', async () => {
    const fetchMock = mockCatalogFetch(
      ['airplane', '../../etc/passwd', ''],
      [
        { id: 'ok', label: 'Ok', icons: ['airplane', '../x'] },
        { id: '../bad', label: 'Bad', icons: ['airplane'] },
      ]
    );
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconCatalog(true));

    await waitFor(() => {
      expect(result.current.names).toEqual(['airplane']);
    });
    expect(result.current.categories).toEqual([{ id: 'ok', label: 'Ok', icons: ['airplane'] }]);
  });

  it('surfaces a catalog failure as an error', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, data: null, error: 'Boom' }),
    } as Response);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useIconCatalog(true));

      await waitFor(() => {
        expect(result.current.error).toBe('Boom');
      });
      expect(result.current.names).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
