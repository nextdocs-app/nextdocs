import { act, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { useSidebarPreferences } from '@/hooks/useSidebarPreferences.hook';
import authReducer from '@/stores/auth/auth.slice';
import sidebarReducer, {
  setCollapsed,
  setSearchQuery,
  setSpaceExpanded,
  togglePrivateOpen,
} from '@/stores/sidebar/sidebar.slice';
import sidebarTreeReducer, {
  addNode,
  toggleExpanded,
} from '@/stores/sidebarTree/sidebarTree.slice';
import sharedTreeReducer from '@/stores/sharedTree/sharedTree.slice';
import spaceTreeReducer, {
  fetchSpaceRootsThunk,
  setStoredSpaces,
  toggleNodeExpanded,
} from '@/stores/spaceTree/spaceTree.slice';
import {
  DEFAULT_SIDEBAR_UI_PREFERENCES,
  SIDEBAR_COLLAPSED_ATTRIBUTE,
  SIDEBAR_UI_PREFERENCE_KEY,
  sidebarTreePreference,
  sidebarUiPreference,
} from '@/lib/sidebar-preferences.util';
import { documentService } from '@/services/document.service';
import type { TreeNode } from '@/types/tree.types';

jest.mock('../../../services/document.service', () => ({
  documentService: {
    listRootTreeNodes: jest.fn(),
    listChildTreeNodes: jest.fn(),
    listSpaceRootTreeNodes: jest.fn(),
    cachePrivateHierarchy: jest.fn().mockResolvedValue(undefined),
    getAllDocumentsMeta: jest.fn().mockResolvedValue([]),
  },
}));

const USER_ID = 'user-1';
const mockedDocumentService = documentService as jest.Mocked<typeof documentService>;

function page(id = 'doc-1'): TreeNode {
  return {
    id,
    title: 'Roadmap',
    parentId: null,
    orderKey: 'a0',
    hasChildren: true,
    effectiveAccessLevel: 'OWNER',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function Harness({ userId }: { userId: string | null }) {
  useSidebarPreferences(userId);
  return null;
}

function makeStore(accessToken: string | null = null) {
  return configureStore({
    reducer: {
      auth: authReducer,
      sidebar: sidebarReducer,
      sidebarTree: sidebarTreeReducer,
      sharedTree: sharedTreeReducer,
      spaceTree: spaceTreeReducer,
    },
    preloadedState: {
      auth: { ...authReducer(undefined, { type: '@@init' }), accessToken },
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

const storedUi = () => JSON.parse(localStorage.getItem(SIDEBAR_UI_PREFERENCE_KEY) ?? 'null');
const storedTree = () => sidebarTreePreference(USER_ID).read();

/**
 * A fresh page load would re-create these module singletons; a test does not,
 * so the in-memory values are reset explicitly instead of only clearing storage.
 */
function resetRememberedPreferences() {
  localStorage.clear();
  document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
  sidebarUiPreference.applyExternal(
    { v: 1, ...DEFAULT_SIDEBAR_UI_PREFERENCES },
    { persist: false }
  );
  sidebarTreePreference(USER_ID).applyExternal(
    { v: 1, documents: [], spaces: [] },
    { persist: false }
  );
}

describe('useSidebarPreferences', () => {
  beforeEach(resetRememberedPreferences);

  afterEach(() => {
    jest.restoreAllMocks();
    document.documentElement.removeAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE);
  });

  it('adopts the rail the head script already painted', () => {
    sidebarUiPreference.applyExternal({
      v: 1,
      collapsed: true,
      sections: { spaces: true, private: false, shared: true },
    });

    const store = renderHarness();

    expect(store.getState().sidebar.isCollapsed).toBe(true);
    expect(store.getState().sidebar.isPrivateOpen).toBe(false);
    expect(document.documentElement.getAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe('collapsed');
  });

  it('writes a section toggle straight through', () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(togglePrivateOpen());
    });

    expect(storedUi()).toEqual({
      v: 1,
      collapsed: false,
      sections: { spaces: true, private: false, shared: true },
    });
  });

  it('keeps the CSS signal in step with the store', () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(setCollapsed(true));
    });
    expect(document.documentElement.getAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe('collapsed');

    act(() => {
      store.dispatch(setCollapsed(false));
    });
    expect(document.documentElement.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe(false);
  });

  it('writes nothing for a dispatch that changes no remembered state', () => {
    const store = renderHarness();
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    act(() => {
      store.dispatch(setSearchQuery('roadmap'));
    });

    expect(setItem).not.toHaveBeenCalledWith(SIDEBAR_UI_PREFERENCE_KEY, expect.anything());
  });

  it('remembers an unfolded page once the burst settles', async () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page()));
    });
    act(() => {
      store.dispatch(toggleExpanded('doc-1'));
    });

    await waitFor(() => expect(storedTree().documents).toEqual(['doc-1']));
  });

  it('remembers an unfolded page inside a space tree', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue({
      items: [page()],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
      hasMore: false,
    });
    const store = renderHarness(makeStore('token-1'));

    await act(async () => {
      await store.dispatch(
        fetchSpaceRootsThunk({ spaceId: 'space-1' }) as unknown as UnknownAction
      );
    });
    act(() => {
      store.dispatch(toggleNodeExpanded({ spaceId: 'space-1', nodeId: 'doc-1' }));
    });

    await waitFor(() => expect(storedTree().documents).toEqual(['doc-1']));
  });

  it('remembers an unfolded space for a signed-in reader', async () => {
    const store = renderHarness(makeStore('token-1'));

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-1', name: 'Team' }]));
      store.dispatch(setSpaceExpanded({ spaceId: 'space-1', expanded: true }));
    });

    await waitFor(() => expect(storedTree().spaces).toEqual(['space-1']));
  });

  it("does not let a guest rewrite the account's remembered spaces", async () => {
    sidebarTreePreference(USER_ID).set({ documents: [], spaces: ['space-a'] });
    const store = renderHarness();

    act(() => {
      store.dispatch(setStoredSpaces([{ id: 'space-b', name: 'Other' }]));
      store.dispatch(setSpaceExpanded({ spaceId: 'space-b', expanded: true }));
    });

    await waitFor(() => expect(storedTree().documents).toEqual([]));
    expect(storedTree().spaces).toEqual(['space-a']);
  });

  it('coalesces a burst of tree changes into a single write', async () => {
    const store = renderHarness();
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    act(() => {
      store.dispatch(addNode(page()));
      store.dispatch(toggleExpanded('doc-1'));
    });
    act(() => {
      store.dispatch(addNode(page('doc-2')));
    });

    await waitFor(() => expect(storedTree().documents).toEqual(['doc-1']));
    const treeWrites = setItem.mock.calls.filter(
      ([key]) => key === sidebarTreePreference(USER_ID).key
    );
    expect(treeWrites).toHaveLength(1);
  });

  it('does not rewrite a value storage already holds when the flush lands', () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page()));
      store.dispatch(toggleExpanded('doc-1'));
    });
    // Another tab settles exactly the value that is still queued here.
    sidebarTreePreference(USER_ID).applyExternal(
      { v: 1, documents: ['doc-1'], spaces: [] },
      { persist: false }
    );

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(localStorage.getItem(sidebarTreePreference(USER_ID).key)).toBeNull();
  });

  it('flushes a debounced expansion only while the tab is hidden', async () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page()));
      store.dispatch(toggleExpanded('doc-1'));
    });

    const setVisibility = (value: 'visible' | 'hidden') =>
      Object.defineProperty(document, 'visibilityState', { value, configurable: true });

    try {
      setVisibility('visible');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(storedTree().documents).toEqual([]);

      setVisibility('hidden');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(storedTree().documents).toEqual(['doc-1']);
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('forgets a page the reader collapsed', async () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page()));
      store.dispatch(toggleExpanded('doc-1'));
    });
    await waitFor(() => expect(storedTree().documents).toEqual(['doc-1']));

    act(() => {
      store.dispatch(toggleExpanded('doc-1'));
    });

    await waitFor(() => expect(storedTree().documents).toEqual([]));
  });

  it('does not let a superseded write land after the branch came back', async () => {
    // Storage says the page is open. The first pass sees it loaded and closed
    // (the restore has not re-expanded it yet) and queues an empty list; the
    // restore then puts it back, which is what storage already holds.
    sidebarTreePreference(USER_ID).set({ documents: ['doc-1'], spaces: [] });
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page()));
    });
    act(() => {
      store.dispatch(toggleExpanded('doc-1'));
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(storedTree().documents).toEqual(['doc-1']);
  });

  it('does not need the debounce when the page is being left', () => {
    const store = renderHarness();

    act(() => {
      store.dispatch(addNode(page()));
      store.dispatch(toggleExpanded('doc-1'));
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(storedTree().documents).toEqual(['doc-1']);
  });

  it('drops unfolded spaces when the account changes', () => {
    const store = makeStore();
    const { rerender } = render(
      <Provider store={store}>
        <Harness userId="user-a" />
      </Provider>
    );

    act(() => {
      store.dispatch(setSpaceExpanded({ spaceId: 'space-a', expanded: true }));
    });
    expect(store.getState().sidebar.expandedSpaceIds).toEqual(['space-a']);

    rerender(
      <Provider store={store}>
        <Harness userId="user-b" />
      </Provider>
    );

    expect(store.getState().sidebar.expandedSpaceIds).toEqual([]);
  });

  it('follows the rail state another tab chose', () => {
    const store = renderHarness();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SIDEBAR_UI_PREFERENCE_KEY,
          newValue: JSON.stringify({
            v: 1,
            collapsed: true,
            sections: { spaces: false, private: true, shared: true },
          }),
        })
      );
    });

    expect(store.getState().sidebar.isCollapsed).toBe(true);
    expect(store.getState().sidebar.isSpacesOpen).toBe(false);
    expect(document.documentElement.getAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)).toBe('collapsed');
  });
});
