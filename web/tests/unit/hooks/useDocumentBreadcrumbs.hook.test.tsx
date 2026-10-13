import { renderHook, waitFor } from '@testing-library/react';
import { useAppSelector } from '../../../stores/hooks';
import { documentService } from '../../../services/document.service';
import { useDocumentBreadcrumbs } from '../../../hooks/useDocumentBreadcrumbs.hook';

jest.mock('../../../stores/hooks', () => ({
  useAppSelector: jest.fn(),
  useAppDispatch: () => jest.fn(),
}));

const storedIcon = { type: 'emoji', value: '📚' } as const;

function mockStore() {
  (useAppSelector as unknown as jest.Mock).mockImplementation(
    (selector: (state: unknown) => unknown) =>
      selector({
        sidebarTree: {
          nodes: {
            root: { id: 'root', title: 'Root', icon: null, parentId: null },
            leaf: { id: 'leaf', title: 'Leaf', icon: storedIcon, parentId: 'root' },
          },
        },
        sharedTree: { nodes: {} },
        auth: { accessToken: null },
      })
  );
}

describe('useDocumentBreadcrumbs', () => {
  let breadcrumbsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore();
    breadcrumbsSpy = jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue([]);
  });

  afterEach(() => {
    breadcrumbsSpy.mockRestore();
  });

  it('keeps the stored leaf icon while meta has not loaded yet', async () => {
    const { result } = renderHook(() => useDocumentBreadcrumbs('leaf', 'Leaf', undefined));

    await waitFor(() => {
      expect(result.current.breadcrumbs).toHaveLength(2);
    });

    expect(result.current.breadcrumbs[1]).toMatchObject({ id: 'leaf', icon: storedIcon });
  });

  it('prefers the live icon once meta has loaded', async () => {
    const liveIcon = { type: 'emoji', value: '🚀' } as const;
    const { result } = renderHook(() => useDocumentBreadcrumbs('leaf', 'Leaf', liveIcon));

    await waitFor(() => {
      expect(result.current.breadcrumbs).toHaveLength(2);
    });

    expect(result.current.breadcrumbs[1]).toMatchObject({ id: 'leaf', icon: liveIcon });
  });

  it('keeps a known deletion instead of flashing the stored icon back', async () => {
    const { result } = renderHook(() => useDocumentBreadcrumbs('leaf', 'Leaf', null));

    await waitFor(() => {
      expect(result.current.breadcrumbs).toHaveLength(2);
    });

    expect(result.current.breadcrumbs[1]).toMatchObject({ id: 'leaf' });
    expect(result.current.breadcrumbs[1].icon).toBeNull();
  });
});
