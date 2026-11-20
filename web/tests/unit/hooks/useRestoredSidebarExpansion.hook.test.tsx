import { act, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useRestoredSidebarExpansion } from '@/hooks/useRestoredSidebarExpansion.hook';
import authReducer from '@/stores/auth/auth.slice';
import sidebarReducer, { setSearchQuery } from '@/stores/sidebar/sidebar.slice';
import sidebarTreeReducer, {
  addNode,
  toggleExpanded,
} from '@/stores/sidebarTree/sidebarTree.slice';
import sharedTreeReducer, { syncPublicRoots } from '@/stores/sharedTree/sharedTree.slice';
import spaceTreeReducer, { setStoredSpaces } from '@/stores/spaceTree/spaceTree.slice';
import { sidebarTreePreference } from '@/lib/sidebar-preferences.util';
import { documentService } from '@/services/document.service';
import type { TreeNode } from '@/types/tree.types';

jest.mock('../../../services/document.service', () => ({
  documentService: {
    listRootTreeNodes: jest.fn(),
    listChildTreeNodes: jest.fn(),
    listSpaceRootTreeNodes: jest.fn(),
    listPublicChildren: jest.fn(),
    cachePrivateHierarchy: jest.fn().mockResolvedValue(undefined),
    getAllDocumentsMeta: jest.fn().mockResolvedValue([]),
  },
}));

const mockedDocumentService = documentService as jest.Mocked<typeof documentService>;
const USER_ID = 'user-1';

function page(id: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    title: id,
    parentId: null,
    orderKey: 'a0',
    hasChildren: true,
    effectiveAccessLevel: 'OWNER',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function Harness({ userId }: { userId: string | null }) {
  useRestoredSidebarExpansion(userId);
  return null;
}

function makeStore(accessToken: string | null = 'token-1') {
  return configureStore({
    reducer: {
      auth: authReducer,
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      spaceTree: spaceTreeReducer,
    },
    preloadedState: {
      auth: {
        ...authReducer(undefined, { type: '@@init' }),
        accessToken,
      },
    },
  });
}

function renderHarness(store = makeStore()) {
  render(
    <Provider store={store}>
      <Harness userId={USER_ID} />
    </Provider>
  );
  return store;
}

/** Let the coalescing microtask and its follow-up passes run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useRestoredSidebarExpansion', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockedDocumentService.listChildTreeNodes.mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
    mockedDocumentService.listPublicChildren.mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      hasMore: false,
    });
  });

  it('costs nothing when no branch was remembered', async () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('doc-1')));
    });
    await settle();

    expect(store.getState().sidebarTree.nodes['doc-1'].isExpanded).toBe(false);
    expect(mockedDocumentService.listChildTreeNodes).not.toHaveBeenCalled();
  });

  it('keeps a remembered space pending until the listing proves access', async () => {
    sidebarTreePreference(USER_ID).set({ documents: [], spaces: ['space-1'] });
    const store = renderHarness();

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-2', name: 'Other' }]));
    });
    await settle();

    expect(store.getState().sidebar.expandedSpaceIds).toEqual([]);
    expect(mockedDocumentService.listSpaceRootTreeNodes).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-1', name: 'Team' }]));
    });

    await waitFor(() => expect(store.getState().sidebar.expandedSpaceIds).toEqual(['space-1']));
    expect(mockedDocumentService.listSpaceRootTreeNodes).toHaveBeenCalledWith(
      'token-1',
      'space-1',
      0
    );
  });

  it('re-opens a remembered page inside a space', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['doc-1'], spaces: ['space-1'] });
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue({
      items: [page('doc-1')],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });
    const store = renderHarness();

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-1', name: 'Team' }]));
    });

    await waitFor(() =>
      expect(store.getState().spaceTree.trees['space-1']?.nodes['doc-1']?.isExpanded).toBe(true)
    );
    expect(mockedDocumentService.listChildTreeNodes).toHaveBeenCalledWith('doc-1', 'token-1', 0);
  });

  it('loads a remembered shared page through the public endpoint for a guest', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['shared-1'], spaces: [] });
    const store = renderHarness(makeStore(null));

    act(() => {
      store.dispatch(syncPublicRoots([page('shared-1')]));
    });

    await waitFor(() =>
      expect(mockedDocumentService.listPublicChildren).toHaveBeenCalledWith('shared-1', 0, 50)
    );
    expect(store.getState().sharedTree.nodes['shared-1'].isExpanded).toBe(true);
    expect(mockedDocumentService.listChildTreeNodes).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-opens a remembered page once its branch loads', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['doc-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('doc-1')));
    });

    await waitFor(() =>
      expect(mockedDocumentService.listChildTreeNodes).toHaveBeenCalledWith(
        'doc-1',
        'token-1',
        0,
        50
      )
    );
    expect(store.getState().sidebarTree.nodes['doc-1'].isExpanded).toBe(true);
  });

  it('re-opens a page that has no children without asking for them', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['doc-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('doc-1', { hasChildren: false })));
    });
    await settle();

    expect(store.getState().sidebarTree.nodes['doc-1'].isExpanded).toBe(true);
    expect(mockedDocumentService.listChildTreeNodes).not.toHaveBeenCalled();
  });

  it('does not re-run a pass for a change that leaves every tree in place', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['gone-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('doc-2')));
    });
    await settle();

    act(() => {
      store.dispatch(setSearchQuery('roadmap'));
    });
    await settle();

    // The remembered id never loaded, so nothing was expanded or fetched, and
    // an unrelated dispatch must not change that.
    expect(store.getState().sidebarTree.nodes['doc-2'].isExpanded).toBe(false);
    expect(mockedDocumentService.listChildTreeNodes).not.toHaveBeenCalled();
  });

  it('leaves pages it never sees alone', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['gone-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('doc-2')));
    });
    await settle();

    expect(mockedDocumentService.listChildTreeNodes).not.toHaveBeenCalled();
    expect(store.getState().sidebarTree.nodes['doc-2'].isExpanded).toBe(false);
  });

  it('does not fight a reader who collapses a restored page', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['doc-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('doc-1')));
    });
    await waitFor(() => expect(store.getState().sidebarTree.nodes['doc-1'].isExpanded).toBe(true));

    act(() => {
      store.dispatch(toggleExpanded('doc-1'));
    });
    act(() => {
      // Any later tree change re-runs the restorer's pass.
      store.dispatch(addNode(page('doc-2')));
    });
    await settle();

    expect(store.getState().sidebarTree.nodes['doc-1'].isExpanded).toBe(false);
  });

  it('re-opens a remembered space and loads its roots', async () => {
    sidebarTreePreference(USER_ID).set({ documents: [], spaces: ['space-1'] });
    const store = renderHarness();

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-1', name: 'Team' }]));
    });

    await waitFor(() =>
      expect(mockedDocumentService.listSpaceRootTreeNodes).toHaveBeenCalledWith(
        'token-1',
        'space-1',
        0
      )
    );
    expect(store.getState().sidebar.expandedSpaceIds).toEqual(['space-1']);
  });

  it('re-opens a remembered page in the shared tree', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['shared-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(syncPublicRoots([page('shared-1')]));
    });

    await waitFor(() =>
      expect(mockedDocumentService.listChildTreeNodes).toHaveBeenCalledWith(
        'shared-1',
        'token-1',
        0,
        50
      )
    );
    expect(store.getState().sharedTree.nodes['shared-1'].isExpanded).toBe(true);
  });

  it('restores a nested branch one request per level', async () => {
    sidebarTreePreference(USER_ID).set({
      documents: ['parent-1', 'child-1', 'leaf-1'],
      spaces: [],
    });
    mockedDocumentService.listChildTreeNodes.mockImplementation(async (parentId) => ({
      items:
        parentId === 'parent-1'
          ? [page('child-1', { parentId: 'parent-1' })]
          : [page('leaf-1', { parentId: 'child-1', hasChildren: false })],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    }));
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page('parent-1')));
    });

    await waitFor(() =>
      expect(store.getState().sidebarTree.nodes['leaf-1']?.isExpanded).toBe(true)
    );
    expect(
      mockedDocumentService.listChildTreeNodes.mock.calls.map(([parentId]) => parentId)
    ).toEqual(['parent-1', 'child-1']);
  });

  it('stops listening once every remembered id has been handled', async () => {
    sidebarTreePreference(USER_ID).set({ documents: ['doc-1'], spaces: [] });
    const store = makeStore();
    const unsubscribe = jest.fn();
    const originalSubscribe = store.subscribe.bind(store);
    jest.spyOn(store, 'subscribe').mockImplementation((listener) => {
      const stop = originalSubscribe(listener);
      return () => {
        unsubscribe();
        stop();
      };
    });
    renderHarness(store);

    act(() => {
      store.dispatch(addNode(page('doc-1', { hasChildren: false })));
    });

    await waitFor(() => expect(store.getState().sidebarTree.nodes['doc-1'].isExpanded).toBe(true));
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not restore spaces for a signed-out reader', async () => {
    sidebarTreePreference(USER_ID).set({ documents: [], spaces: ['space-1'] });
    const store = renderHarness(makeStore(null));

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-1', name: 'Team' }]));
    });
    await settle();

    expect(mockedDocumentService.listSpaceRootTreeNodes).not.toHaveBeenCalled();
    expect(store.getState().sidebar.expandedSpaceIds).toEqual([]);
  });
});
