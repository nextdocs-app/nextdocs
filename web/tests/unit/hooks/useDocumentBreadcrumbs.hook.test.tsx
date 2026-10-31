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
        spaceTree: {
          trees: {
            'space-1': {
              nodes: {
                'space-root': { id: 'space-root', title: 'Space Root', icon: null, parentId: null },
                'space-child': {
                  id: 'space-child',
                  title: 'Space Child',
                  icon: null,
                  parentId: 'space-root',
                },
              },
              rootIds: ['space-root'],
              isRootLoading: false,
            },
          },
          spaces: {
            'space-1': {
              id: 'space-1',
              name: 'Design Space',
              icon: { type: 'builtin', value: 'palette', color: 'purple' },
            },
          },
        },
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

  it('resolves space hierarchy from local spaceTree nodes', async () => {
    const { result } = renderHook(() => useDocumentBreadcrumbs('space-child', 'Space Child', null));

    await waitFor(() => {
      expect(result.current.breadcrumbs).toHaveLength(2);
    });

    expect(result.current.space).toEqual({
      id: 'space-1',
      name: 'Design Space',
      icon: { type: 'builtin', value: 'palette', color: 'purple' },
    });
    expect(result.current.breadcrumbs[0]).toMatchObject({
      id: 'space-root',
      title: 'Space Root',
      space: { id: 'space-1', name: 'Design Space' },
    });
  });

  it('resolves space from server breadcrumbs', async () => {
    breadcrumbsSpy.mockResolvedValue([
      {
        id: 'doc-remote',
        title: 'Remote Doc',
        parentId: null,
        space: {
          id: 'space-2',
          name: 'Server Space',
          icon: { type: 'emoji', value: '🌟' },
        },
      },
    ]);

    const { result } = renderHook(() => useDocumentBreadcrumbs('doc-remote', 'Remote Doc', null));

    await waitFor(() => {
      expect(result.current.space).toEqual({
        id: 'space-2',
        name: 'Server Space',
        icon: { type: 'emoji', value: '🌟' },
      });
      expect(result.current.breadcrumbs[0].title).toBe('Remote Doc');
    });
  });
});
