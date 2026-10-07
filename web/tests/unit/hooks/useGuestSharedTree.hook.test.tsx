import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import sharedTreeReducer, { syncPublicRoots } from '@/stores/sharedTree/sharedTree.slice';
import authReducer from '@/stores/auth/auth.slice';
import { useGuestSharedTree } from '@/hooks/useGuestSharedTree.hook';
import { documentService, DocumentServiceApiError } from '@/services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

describe('useGuestSharedTree', () => {
  let store: ReturnType<typeof createTestStore>;

  function createTestStore(initialAuthState = {}) {
    return configureStore({
      reducer: {
        sharedTree: sharedTreeReducer,
        auth: authReducer,
      },
      preloadedState: {
        auth: {
          user: null,
          accessToken: null,
          expiresAt: null,
          lastAuthAction: null,
          lastSilentRefreshAt: null,
          isLoading: false,
          isInitializing: false,
          error: null,
          ...initialAuthState,
        },
      },
    });
  }

  function createWrapper(testStore: typeof store) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={testStore}>{children}</Provider>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
    });
    store = createTestStore();
  });

  it('populates breadcrumb chain and prefers server fields', async () => {
    const crumbs = [
      {
        id: 'doc-root',
        title: 'Root Doc',
        parentId: null,
        orderKey: 'order-root',
        accessLevel: 'EDIT' as const,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      },
      {
        id: 'doc-child',
        title: 'Child Doc',
        parentId: 'doc-root',
        orderKey: 'order-child',
        accessLevel: 'COMMENT' as const,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-04T00:00:00Z',
      },
    ];

    jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue(crumbs);
    jest.spyOn(documentService, 'listPublicChildren').mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useGuestSharedTree('doc-child'), {
      wrapper: createWrapper(store),
    });

    expect(result.current.isGuestSharedLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });

    const state = store.getState().sharedTree;
    expect(state.rootIds).toEqual(['doc-root']);

    const rootNode = state.nodes['doc-root'];
    expect(rootNode).toMatchObject({
      id: 'doc-root',
      title: 'Root Doc',
      parentId: null,
      orderKey: 'order-root',
      effectiveAccessLevel: 'EDIT',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      hasChildren: true,
    });

    const childNode = state.nodes['doc-child'];
    expect(childNode).toMatchObject({
      id: 'doc-child',
      title: 'Child Doc',
      parentId: 'doc-root',
      orderKey: 'order-child',
      effectiveAccessLevel: 'COMMENT',
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-04T00:00:00Z',
    });
  });

  it('uses fallback values when breadcrumbs omit optional server fields', async () => {
    const crumbs = [
      {
        id: 'doc-bare',
        title: '',
      },
    ];

    jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue(crumbs);
    jest.spyOn(documentService, 'listPublicChildren').mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useGuestSharedTree('doc-bare'), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });

    const bareNode = store.getState().sharedTree.nodes['doc-bare'];
    expect(bareNode).toMatchObject({
      id: 'doc-bare',
      title: 'Untitled',
      parentId: null,
      orderKey: 'public:0000',
      effectiveAccessLevel: 'VIEW',
      createdAt: '',
      updatedAt: '',
    });
  });

  it('falls back to VIEW for a malformed breadcrumb access level', async () => {
    const crumbs = [
      {
        id: 'doc-odd',
        title: 'Odd',
        parentId: null,
        orderKey: 'order-odd',
        accessLevel: 'SUPERADMIN',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      },
    ];

    jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue(crumbs as never);
    jest.spyOn(documentService, 'listPublicChildren').mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useGuestSharedTree('doc-odd'), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });

    expect(store.getState().sharedTree.nodes['doc-odd']).toMatchObject({
      effectiveAccessLevel: 'VIEW',
    });
  });

  it('resets tree on 403 or 404 error (link revoked/not found)', async () => {
    jest
      .spyOn(documentService, 'getDocumentBreadcrumbs')
      .mockRejectedValue(new DocumentServiceApiError('Forbidden', 403));

    // Pre-populate tree with a stale node
    store.dispatch(
      syncPublicRoots([
        {
          id: 'stale-doc',
          title: 'Stale',
          parentId: null,
          orderKey: 'order-0',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          createdAt: '',
          updatedAt: '',
        },
      ])
    );
    expect(store.getState().sharedTree.rootIds).toEqual(['stale-doc']);

    const { result } = renderHook(() => useGuestSharedTree('stale-doc'), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });

    expect(store.getState().sharedTree.rootIds).toEqual([]);
    expect(store.getState().sharedTree.nodes).toEqual({});
  });

  it('preserves existing tree on 429 rate limit or network connectivity error', async () => {
    jest
      .spyOn(documentService, 'getDocumentBreadcrumbs')
      .mockRejectedValue(new DocumentServiceApiError('Too Many Requests', 429));

    // Pre-populate tree
    store.dispatch(
      syncPublicRoots([
        {
          id: 'existing-doc',
          title: 'Existing',
          parentId: null,
          orderKey: 'order-0',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          createdAt: '',
          updatedAt: '',
        },
      ])
    );

    const { result } = renderHook(() => useGuestSharedTree('existing-doc'), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });

    // Node is kept instead of flashing empty tree
    expect(store.getState().sharedTree.rootIds).toEqual(['existing-doc']);
    expect(store.getState().sharedTree.nodes['existing-doc']).toBeDefined();
  });

  it('swallows children fetch failure without clearing breadcrumb chain', async () => {
    const crumbs = [
      {
        id: 'doc-active',
        title: 'Active Doc',
        parentId: null,
        orderKey: 'order-active',
        accessLevel: 'VIEW' as const,
      },
    ];

    jest.spyOn(documentService, 'getDocumentBreadcrumbs').mockResolvedValue(crumbs);
    jest
      .spyOn(documentService, 'listPublicChildren')
      .mockRejectedValue(new Error('Network error on children fetch'));

    const { result } = renderHook(() => useGuestSharedTree('doc-active'), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });

    // Breadcrumb node remains in tree despite child fetch failure
    expect(store.getState().sharedTree.rootIds).toEqual(['doc-active']);
    expect(store.getState().sharedTree.nodes['doc-active']).toBeDefined();
  });

  it('drops a superseded load instead of fetching children for the document left behind', async () => {
    type Crumbs = Awaited<ReturnType<typeof documentService.getDocumentBreadcrumbs>>;
    let resolveStaleCrumbs: (value: Crumbs) => void = () => {};
    jest
      .spyOn(documentService, 'getDocumentBreadcrumbs')
      .mockImplementationOnce(
        () =>
          new Promise<Crumbs>((resolve) => {
            resolveStaleCrumbs = resolve;
          })
      )
      .mockResolvedValue([
        {
          id: 'doc-second',
          title: 'Second Doc',
          parentId: null,
          orderKey: 'order-second',
          accessLevel: 'VIEW' as const,
        },
      ]);
    const listPublicChildrenSpy = jest
      .spyOn(documentService, 'listPublicChildren')
      .mockResolvedValue({
        items: [],
        page: 0,
        size: 50,
        totalElements: 0,
        totalPages: 1,
        hasMore: false,
      });

    const { result, rerender } = renderHook(
      ({ docId }: { docId: string }) => useGuestSharedTree(docId),
      { wrapper: createWrapper(store), initialProps: { docId: 'doc-first' } }
    );

    rerender({ docId: 'doc-second' });
    await waitFor(() => {
      expect(store.getState().sharedTree.rootIds).toEqual(['doc-second']);
    });

    // The first document's chain finally arrives, long after navigation.
    await act(async () => {
      resolveStaleCrumbs([]);
    });

    expect(listPublicChildrenSpy).toHaveBeenCalledTimes(1);
    expect(listPublicChildrenSpy).toHaveBeenCalledWith('doc-second', 0, 50);
    expect(store.getState().sharedTree.rootIds).toEqual(['doc-second']);
    await waitFor(() => {
      expect(result.current.isGuestSharedLoading).toBe(false);
    });
  });

  it('does nothing when user is authenticated', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'auth-token',
    });

    const getCrumbsSpy = jest.spyOn(documentService, 'getDocumentBreadcrumbs');

    const { result } = renderHook(() => useGuestSharedTree('doc-1'), {
      wrapper: createWrapper(store),
    });

    expect(result.current.isGuestSharedLoading).toBe(false);
    expect(getCrumbsSpy).not.toHaveBeenCalled();
  });

  it('resets tree when auth state transitions', () => {
    // Pre-populate tree
    store.dispatch(
      syncPublicRoots([
        {
          id: 'guest-doc',
          title: 'Guest Doc',
          parentId: null,
          orderKey: 'order-0',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          createdAt: '',
          updatedAt: '',
        },
      ])
    );

    let authState: { isAuthenticated: boolean; accessToken: string | null } = {
      isAuthenticated: false,
      accessToken: null,
    };
    (useAuth as jest.Mock).mockImplementation(() => authState);

    const { rerender } = renderHook(() => useGuestSharedTree('guest-doc'), {
      wrapper: createWrapper(store),
    });

    expect(store.getState().sharedTree.rootIds).toEqual(['guest-doc']);

    // User logs in
    authState = { isAuthenticated: true, accessToken: 'token-abc' };
    rerender();

    expect(store.getState().sharedTree.rootIds).toEqual([]);
    expect(store.getState().sharedTree.nodes).toEqual({});
  });
});
