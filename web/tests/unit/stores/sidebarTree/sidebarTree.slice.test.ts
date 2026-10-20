import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import sidebarTreeReducer, {
  addNode,
  fetchRootNodesThunk,
  removeNode,
  resetTree,
  setNodeExpanded,
  toggleExpanded,
  updateNodeMeta,
  compareOrderKeys,
  type SidebarTreeState,
} from '@/stores/sidebarTree/sidebarTree.slice';
import { documentService } from '../../../../services/document.service';
import { getLocalDocumentParents } from '../../../../lib/local-tree.util';
import { queuePendingCloudCreate } from '../../../../lib/pending-cloud-create.util';
import type { TreeNode } from '@/types/tree.types';

jest.mock('../../../../services/document.service', () => ({
  documentService: {
    listRootTreeNodes: jest.fn(),
    cachePrivateHierarchy: jest.fn().mockResolvedValue(undefined),
    getAllDocumentsMeta: jest.fn(),
  },
}));
jest.mock('../../../../lib/local-tree.util', () => ({
  getLocalDocumentParents: jest.fn(),
}));

describe('sidebarTree.slice', () => {
  const initialState: SidebarTreeState = {
    nodes: {},
    rootIds: [],
    isRootLoading: false,
    rootHasMore: false,
    rootPage: 0,
  };

  describe('compareOrderKeys', () => {
    it('sorts keys correctly in lexicographical order', () => {
      expect(compareOrderKeys('a0', 'a1')).toBe(-1);
      expect(compareOrderKeys('a1', 'a0')).toBe(1);
      expect(compareOrderKeys('a0', 'a0')).toBe(0);
    });
  });

  describe('reducers', () => {
    it('toggles and sets expanded state', () => {
      const stateWithNode: SidebarTreeState = {
        ...initialState,
        nodes: {
          'doc-1': {
            id: 'doc-1',
            title: 'Doc 1',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER',
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['doc-1'],
      };

      const toggled = sidebarTreeReducer(stateWithNode, toggleExpanded('doc-1'));
      expect(toggled.nodes['doc-1'].isExpanded).toBe(true);

      const setExplicit = sidebarTreeReducer(
        toggled,
        setNodeExpanded({ id: 'doc-1', expanded: false })
      );
      expect(setExplicit.nodes['doc-1'].isExpanded).toBe(false);
    });

    it('updates node metadata title', () => {
      const stateWithNode: SidebarTreeState = {
        ...initialState,
        nodes: {
          'doc-1': {
            id: 'doc-1',
            title: 'Old Title',
            parentId: null,
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER',
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['doc-1'],
      };

      const updated = sidebarTreeReducer(
        stateWithNode,
        updateNodeMeta({ id: 'doc-1', title: 'New Title' })
      );
      expect(updated.nodes['doc-1'].title).toBe('New Title');
    });

    it('falls back to Untitled for whitespace-only titles', () => {
      const stateWithNode: SidebarTreeState = {
        ...initialState,
        nodes: {
          'doc-1': {
            id: 'doc-1',
            title: 'Old Title',
            parentId: null,
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER',
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['doc-1'],
      };

      const updated = sidebarTreeReducer(
        stateWithNode,
        updateNodeMeta({ id: 'doc-1', title: '   ' })
      );
      expect(updated.nodes['doc-1'].title).toBe('Untitled');
    });

    it('sanitizes an icon update instead of trusting it', () => {
      const stateWithNode: SidebarTreeState = {
        ...initialState,
        nodes: {
          'doc-1': {
            id: 'doc-1',
            title: 'Doc',
            parentId: null,
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER',
            icon: { type: 'emoji', value: '📝' },
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['doc-1'],
      };

      const cleared = sidebarTreeReducer(
        stateWithNode,
        updateNodeMeta({
          id: 'doc-1',
          icon: { type: 'link', value: 'javascript:alert(1)' } as never,
        })
      );
      expect(cleared.nodes['doc-1'].icon).toBeNull();

      const set = sidebarTreeReducer(
        stateWithNode,
        updateNodeMeta({ id: 'doc-1', icon: { type: 'emoji', value: '🚀' } })
      );
      expect(set.nodes['doc-1'].icon).toEqual({ type: 'emoji', value: '🚀' });
    });

    it('adds root nodes and child nodes with proper ordering', () => {
      const rootNode1: TreeNode = {
        id: 'doc-1',
        title: 'Doc 1',
        parentId: null,
        orderKey: 'a1',
        hasChildren: false,
        effectiveAccessLevel: 'OWNER',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T10:00:00Z',
      };
      const rootNode0: TreeNode = {
        id: 'doc-0',
        title: 'Doc 0',
        parentId: null,
        orderKey: 'a0',
        hasChildren: false,
        effectiveAccessLevel: 'OWNER',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T10:00:00Z',
      };

      let state = sidebarTreeReducer(initialState, addNode(rootNode1));
      expect(state.rootIds).toEqual(['doc-1']);

      state = sidebarTreeReducer(state, addNode(rootNode0));
      expect(state.rootIds).toEqual(['doc-0', 'doc-1']);

      const childNode: TreeNode = {
        id: 'child-1',
        title: 'Child 1',
        parentId: 'doc-0',
        orderKey: 'b0',
        hasChildren: false,
        effectiveAccessLevel: 'OWNER',
        createdAt: '2024-01-01T10:00:00Z',
        updatedAt: '2024-01-01T10:00:00Z',
      };

      state = sidebarTreeReducer(state, addNode(childNode));
      expect(state.nodes['doc-0'].hasChildren).toBe(true);
      expect(state.nodes['doc-0'].children).toEqual(['child-1']);
      expect(state.nodes['doc-0'].isExpanded).toBe(true);
    });

    it('resets tree state', () => {
      const populatedState: SidebarTreeState = {
        nodes: {
          'doc-1': {
            id: 'doc-1',
            title: 'Doc 1',
            parentId: null,
            orderKey: 'a0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER',
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['doc-1'],
        isRootLoading: true,
        rootHasMore: true,
        rootPage: 2,
      };

      const reset = sidebarTreeReducer(populatedState, resetTree());
      expect(reset.nodes).toEqual({});
      expect(reset.rootIds).toEqual([]);
      expect(reset.isRootLoading).toBe(false);
      expect(reset.rootHasMore).toBe(false);
      expect(reset.rootPage).toBe(0);
    });

    it('recursively removes target node and all nested descendants on removeNode', () => {
      const stateWithHierarchy: SidebarTreeState = {
        ...initialState,
        nodes: {
          'root-1': {
            id: 'root-1',
            title: 'Root 1',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER',
            isExpanded: true,
            isLoading: false,
            children: ['child-1', 'child-2'],
            childrenLoaded: true,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
          'child-1': {
            id: 'child-1',
            title: 'Child 1',
            parentId: 'root-1',
            orderKey: 'b0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER',
            isExpanded: true,
            isLoading: false,
            children: ['grandchild-1'],
            childrenLoaded: true,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
          'child-2': {
            id: 'child-2',
            title: 'Child 2',
            parentId: 'root-1',
            orderKey: 'b1',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER',
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
          'grandchild-1': {
            id: 'grandchild-1',
            title: 'Grandchild 1',
            parentId: 'child-1',
            orderKey: 'c0',
            hasChildren: false,
            effectiveAccessLevel: 'OWNER',
            isExpanded: false,
            isLoading: false,
            children: [],
            childrenLoaded: false,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
          },
        },
        rootIds: ['root-1'],
      };

      // Removing child-1 should remove child-1 and grandchild-1, leaving root-1 and child-2
      let state = sidebarTreeReducer(stateWithHierarchy, removeNode('child-1'));
      expect(state.nodes['child-1']).toBeUndefined();
      expect(state.nodes['grandchild-1']).toBeUndefined();
      expect(state.nodes['root-1'].children).toEqual(['child-2']);
      expect(state.nodes['child-2']).toBeDefined();

      // Removing root-1 should remove root-1 and child-2
      state = sidebarTreeReducer(state, removeNode('root-1'));
      expect(state.rootIds).toEqual([]);
      expect(state.nodes['root-1']).toBeUndefined();
      expect(state.nodes['child-2']).toBeUndefined();
      expect(state.nodes).toEqual({});
    });
  });

  describe('degraded local roots', () => {
    const localDoc = (id: string, title: string, updatedAt: string) => ({
      id,
      meta: { title, createdAt: '2024-01-01T10:00:00Z', updatedAt },
    });

    // The thunk is typed against the full RootState; these tests mount only the
    // slices it reads.
    async function dispatchFetch(
      store: { dispatch: (action: UnknownAction) => unknown },
      params?: { background?: boolean }
    ): Promise<void> {
      await store.dispatch(fetchRootNodesThunk(params) as unknown as UnknownAction);
    }

    it('nests an offline-created child under a parent that is merged later', async () => {
      (documentService.listRootTreeNodes as jest.Mock).mockRejectedValue(new Error('offline'));
      // UpdatedAt order puts the new child before the parent it was created in.
      (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
        localDoc('child', 'Child', '2024-01-02T10:00:00Z'),
        localDoc('parent', 'Parent', '2024-01-01T10:00:00Z'),
      ]);
      (getLocalDocumentParents as jest.Mock).mockReturnValue(new Map([['child', 'parent']]));

      const store = configureStore({
        reducer: {
          auth: () => ({ accessToken: 'token-1', user: { id: 'user-1' } }),
          sidebarTree: sidebarTreeReducer,
        },
      });

      await dispatchFetch(store);

      const state = store.getState().sidebarTree;
      expect(state.rootIds).toEqual(['parent']);
      expect(state.nodes['parent'].children).toEqual(['child']);
      expect(state.nodes['child'].parentId).toBe('parent');
    });

    it('keeps a pending offline-created child visible under its cloud parent', async () => {
      (documentService.listRootTreeNodes as jest.Mock).mockResolvedValue({
        items: [
          {
            id: 'parent',
            title: 'Parent',
            parentId: null,
            orderKey: 'a0',
            hasChildren: true,
            effectiveAccessLevel: 'OWNER',
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
            icon: null,
          },
        ],
        hasMore: false,
        page: 0,
      });
      (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
        localDoc('child', 'Child', '2024-01-02T10:00:00Z'),
      ]);
      (getLocalDocumentParents as jest.Mock).mockReturnValue(new Map([['child', 'parent']]));
      queuePendingCloudCreate({ id: 'child', userId: 'user-1', parentId: 'parent' });

      const store = configureStore({
        reducer: {
          auth: () => ({ accessToken: 'token-1', user: { id: 'user-1' } }),
          sidebarTree: sidebarTreeReducer,
        },
      });

      try {
        await dispatchFetch(store);

        const state = store.getState().sidebarTree;
        expect(state.rootIds).toEqual(['parent']);
        expect(state.nodes['parent'].children).toEqual(['child']);
        expect(state.nodes['child'].parentId).toBe('parent');
        expect(documentService.cachePrivateHierarchy).toHaveBeenCalledWith('token-1', 'user-1');
      } finally {
        window.localStorage.removeItem('nextdocs:pending-cloud-create:child');
      }
    });

    it('restores a pending root that a cloud refresh detached', async () => {
      (documentService.listRootTreeNodes as jest.Mock).mockResolvedValue({
        items: [],
        hasMore: false,
        page: 0,
      });
      (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
        localDoc('pending-root', 'Pending root', '2024-01-02T10:00:00Z'),
      ]);
      (getLocalDocumentParents as jest.Mock).mockReturnValue(new Map());
      queuePendingCloudCreate({ id: 'pending-root', userId: 'user-1', parentId: null });

      const store = configureStore({
        reducer: {
          auth: () => ({ accessToken: 'token-1', user: { id: 'user-1' } }),
          sidebarTree: sidebarTreeReducer,
        },
        preloadedState: {
          sidebarTree: {
            ...initialState,
            nodes: {
              'pending-root': {
                id: 'pending-root',
                title: 'Pending root',
                parentId: null,
                orderKey: 'local:pending-root',
                hasChildren: false,
                effectiveAccessLevel: 'OWNER' as const,
                isExpanded: false,
                isLoading: false,
                children: [],
                childrenLoaded: false,
                createdAt: '2024-01-02T10:00:00Z',
                updatedAt: '2024-01-02T10:00:00Z',
              },
            },
          },
        },
      });

      try {
        await dispatchFetch(store);

        expect(store.getState().sidebarTree.rootIds).toEqual(['pending-root']);
      } finally {
        window.localStorage.removeItem('nextdocs:pending-cloud-create:pending-root');
      }
    });

    it('keeps a cached nested document under its cloud parent when it has no local link', async () => {
      (documentService.listRootTreeNodes as jest.Mock).mockRejectedValue(new Error('offline'));
      (documentService.getAllDocumentsMeta as jest.Mock).mockResolvedValue([
        localDoc('nested', 'Nested', '2024-01-01T10:00:00Z'),
      ]);
      (getLocalDocumentParents as jest.Mock).mockReturnValue(new Map());

      const store = configureStore({
        reducer: {
          auth: () => ({ accessToken: 'token-1', user: { id: 'user-1' } }),
          sidebarTree: sidebarTreeReducer,
        },
        preloadedState: {
          sidebarTree: {
            nodes: {
              root: {
                id: 'root',
                title: 'Root',
                parentId: null,
                orderKey: 'a0',
                hasChildren: true,
                effectiveAccessLevel: 'OWNER' as const,
                isExpanded: true,
                isLoading: false,
                children: ['nested'],
                childrenLoaded: true,
                createdAt: '2024-01-01T10:00:00Z',
                updatedAt: '2024-01-01T10:00:00Z',
              },
              nested: {
                id: 'nested',
                title: 'Nested',
                parentId: 'root',
                orderKey: 'a1',
                hasChildren: false,
                effectiveAccessLevel: 'OWNER' as const,
                isExpanded: false,
                isLoading: false,
                children: [],
                childrenLoaded: false,
                createdAt: '2024-01-01T10:00:00Z',
                updatedAt: '2024-01-01T10:00:00Z',
              },
            },
            rootIds: ['root'],
            isRootLoading: false,
            rootHasMore: false,
            rootPage: 0,
          },
        },
      });

      await dispatchFetch(store, { background: true });

      const state = store.getState().sidebarTree;
      expect(state.rootIds).toEqual(['root']);
      expect(state.nodes['nested'].parentId).toBe('root');
      expect(state.nodes['root'].children).toEqual(['nested']);
    });
  });
});
