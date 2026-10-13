import { renderHook, waitFor } from '@testing-library/react';
import { resetIconBundleCache, useIconBundle } from '../../../hooks/useIconBundle.hook';

function mockBundleFetch(icons: Record<string, unknown>) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { icons, source: 'test', license: 'test' },
      error: null,
    }),
  } as Response);
}

describe('useIconBundle', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetIconBundleCache();
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    resetIconBundleCache();
  });

  it('does not fetch until a picker shows the catalog', () => {
    const fetchMock = mockBundleFetch({ airplane: '<svg></svg>' });
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconBundle(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toEqual({ bundle: null, isLoading: false, error: null });
  });

  it('fetches once and shares the bundle across mounts', async () => {
    const fetchMock = mockBundleFetch({ airplane: '<svg>a</svg>', alarm: '<svg>b</svg>' });
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const first = renderHook(() => useIconBundle(true));
    const second = renderHook(() => useIconBundle(true));

    await waitFor(() => {
      expect(first.result.current.bundle?.get('airplane')).toBe('<svg>a</svg>');
    });
    await waitFor(() => {
      expect(second.result.current.bundle?.get('alarm')).toBe('<svg>b</svg>');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.result.current.isLoading).toBe(false);
  });

  it('drops malformed glyph entries instead of failing the bundle', async () => {
    const fetchMock = mockBundleFetch({
      airplane: '<svg>a</svg>',
      broken: 'not an svg',
      numeric: 42,
    });
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconBundle(true));

    await waitFor(() => {
      expect(result.current.bundle?.size).toBe(1);
    });
    expect(result.current.bundle?.get('airplane')).toBe('<svg>a</svg>');
    expect(result.current.error).toBeNull();
  });

  it('drops glyph entries whose slug could not name a catalog icon', async () => {
    const fetchMock = mockBundleFetch({
      airplane: '<svg>a</svg>',
      '../secret': '<svg>b</svg>',
      'not a slug': '<svg>c</svg>',
    });
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useIconBundle(true));

    await waitFor(() => {
      expect(result.current.bundle?.size).toBe(1);
    });
    expect(result.current.bundle?.get('airplane')).toBe('<svg>a</svg>');
  });

  it('surfaces a bundle failure as an error with a null bundle', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, data: null, error: 'Boom' }),
    } as Response);
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useIconBundle(true));

      await waitFor(() => {
        expect(result.current.error).toBe('Boom');
      });
      expect(result.current.bundle).toBeNull();
      expect(result.current.isLoading).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
