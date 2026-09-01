import sidebarTreeReducer, {
  addNode,
  removeNode,
  resetTree,
  setNodeExpanded,
  toggleExpanded,
  updateNodeMeta,
  compareOrderKeys,
  type SidebarTreeState,
} from '@/stores/sidebarTree/sidebarTree.slice';
import type { TreeNode } from '@/types/tree.types';

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
});
