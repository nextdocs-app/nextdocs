import type { DocumentAccessLevel } from '@/services/document.service';
import sharedTreeReducer, {
  syncSharedRoots,
  type SharedTreeState,
} from '@/stores/sharedTree/sharedTree.slice';
import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';

const entry = (
  id: string,
  relationship: 'owner' | 'collaborator',
  parentId: string | null,
  title = id,
  accessLevel?: DocumentAccessLevel | null
): SharedDocumentEntry => ({
  id,
  relationship,
  parentId,
  accessLevel,
  meta: { title, updatedAt: '2024-01-01T11:00:00Z', createdAt: '2024-01-01T10:00:00Z' },
});

describe('sharedTree.slice syncSharedRoots', () => {
  const initialState: SharedTreeState = { nodes: {}, rootIds: [] };

  it('sets effectiveAccessLevel to EDIT for collaborator with edit access', () => {
    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([entry('shared-edit', 'collaborator', null, 'Shared Edit', 'EDIT')])
    );

    expect(state.rootIds).toEqual(['shared-edit']);
    expect(state.nodes['shared-edit']).toMatchObject({
      id: 'shared-edit',
      parentId: null,
      effectiveAccessLevel: 'EDIT',
    });
  });

  it('sets effectiveAccessLevel to VIEW for collaborator with view access', () => {
    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([entry('shared-view', 'collaborator', null, 'Shared View', 'VIEW')])
    );

    expect(state.rootIds).toEqual(['shared-view']);
    expect(state.nodes['shared-view']).toMatchObject({
      id: 'shared-view',
      parentId: null,
      effectiveAccessLevel: 'VIEW',
    });
  });

  it('synthesizes root-level owner-shared documents as roots', () => {
    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([entry('root-shared', 'owner', null)])
    );

    expect(state.rootIds).toEqual(['root-shared']);
    expect(state.nodes['root-shared']).toMatchObject({
      id: 'root-shared',
      parentId: null,
      effectiveAccessLevel: 'OWNER',
    });
  });

  it('does NOT synthesize nested owner-shared documents (they stay in the private tree)', () => {
    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([entry('nested-shared', 'owner', 'private-parent')])
    );

    expect(state.rootIds).toEqual([]);
    expect(state.nodes['nested-shared']).toBeUndefined();
  });

  it('prunes a nested owner-shared document that was previously synthesized as a root', () => {
    const previous: SharedTreeState = {
      nodes: {
        'nested-shared': {
          id: 'nested-shared',
          title: 'nested-shared',
          parentId: null,
          orderKey: 'shared:nested-shared',
          hasChildren: false,
          effectiveAccessLevel: 'OWNER',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['nested-shared'],
    };

    const state = sharedTreeReducer(
      previous,
      syncSharedRoots([entry('nested-shared', 'owner', 'private-parent')])
    );

    expect(state.rootIds).toEqual([]);
    expect(state.nodes['nested-shared']).toBeUndefined();
  });

  it('nests a shared-with-me document under its parent when the parent is also shared with me', () => {
    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([
        entry('shared-parent', 'collaborator', null),
        entry('shared-child', 'collaborator', 'shared-parent'),
      ])
    );

    expect(state.rootIds).toEqual(['shared-parent']);
    expect(state.nodes['shared-parent']).toMatchObject({ parentId: null });
    expect(state.nodes['shared-child']).toMatchObject({ parentId: 'shared-parent' });
  });

  it('floats a shared-with-me document at the root when its parent is not shared with me', () => {
    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([entry('orphan-shared', 'collaborator', 'inaccessible-parent')])
    );

    expect(state.rootIds).toEqual(['orphan-shared']);
    expect(state.nodes['orphan-shared']).toMatchObject({ parentId: null });
  });

  it('prunes documents that are no longer shared', () => {
    const previous: SharedTreeState = {
      nodes: {
        'unshared-1': {
          id: 'unshared-1',
          title: 'unshared-1',
          parentId: null,
          orderKey: 'shared:unshared-1',
          hasChildren: false,
          effectiveAccessLevel: 'OWNER',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['unshared-1'],
    };

    const state = sharedTreeReducer(previous, syncSharedRoots([]));

    expect(state.rootIds).toEqual([]);
    expect(state.nodes).toEqual({});
  });

  it('orders roots by the server navigation order key', () => {
    const withKey = (
      id: string,
      relationship: 'owner' | 'collaborator',
      parentId: string | null,
      orderKey: string
    ): SharedDocumentEntry => ({
      id,
      relationship,
      parentId,
      orderKey,
      meta: { title: id, updatedAt: '2024-01-01T11:00:00Z', createdAt: '2024-01-01T10:00:00Z' },
    });

    const state = sharedTreeReducer(
      initialState,
      syncSharedRoots([
        withKey('z-last', 'collaborator', null, 'a2'),
        withKey('a-first', 'owner', null, 'a0'),
        withKey('m-mid', 'collaborator', null, 'a1'),
      ])
    );

    expect(state.rootIds).toEqual(['a-first', 'm-mid', 'z-last']);
    expect(state.nodes['a-first']).toMatchObject({ orderKey: 'a0' });
    expect(state.nodes['m-mid']).toMatchObject({ orderKey: 'a1' });
    expect(state.nodes['z-last']).toMatchObject({ orderKey: 'a2' });
  });

  it('updates order key and resort roots when server navigation order changes', () => {
    const withKey = (
      id: string,
      relationship: 'owner' | 'collaborator',
      parentId: string | null,
      orderKey: string
    ): SharedDocumentEntry => ({
      id,
      relationship,
      parentId,
      orderKey,
      meta: { title: id, updatedAt: '2024-01-01T11:00:00Z', createdAt: '2024-01-01T10:00:00Z' },
    });

    const previous: SharedTreeState = {
      nodes: {
        'doc-a': {
          id: 'doc-a',
          title: 'Doc A',
          parentId: null,
          orderKey: 'a0',
          hasChildren: false,
          effectiveAccessLevel: 'OWNER',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        'doc-b': {
          id: 'doc-b',
          title: 'Doc B',
          parentId: null,
          orderKey: 'a1',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['doc-a', 'doc-b'],
    };

    // Server sends doc-b with orderKey 'Zz' (now before doc-a)
    const state = sharedTreeReducer(
      previous,
      syncSharedRoots([
        withKey('doc-a', 'owner', null, 'a0'),
        withKey('doc-b', 'collaborator', null, 'Zz'),
      ])
    );

    expect(state.rootIds).toEqual(['doc-b', 'doc-a']);
    expect(state.nodes['doc-b'].orderKey).toBe('Zz');
    expect(state.nodes['doc-a'].orderKey).toBe('a0');
  });
});

describe('sharedTree.slice resetTree', () => {
  it('resets nodes and rootIds', () => {
    const previous: SharedTreeState = {
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
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['doc-1'],
    };

    const state = sharedTreeReducer(previous, { type: 'sharedTree/resetTree' });

    expect(state.nodes).toEqual({});
    expect(state.rootIds).toEqual([]);
  });
});

describe('sharedTree.slice removeNode', () => {
  it('removes a root node from rootIds and nodes', () => {
    const initialState: SharedTreeState = {
      nodes: {
        'root-1': {
          id: 'root-1',
          title: 'Root 1',
          parentId: null,
          orderKey: 'a0',
          hasChildren: false,
          effectiveAccessLevel: 'OWNER',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['root-1'],
    };

    const state = sharedTreeReducer(initialState, {
      type: 'sharedTree/removeNode',
      payload: 'root-1',
    });

    expect(state.rootIds).toEqual([]);
    expect(state.nodes['root-1']).toBeUndefined();
  });

  it('removes a child node from its parent children list and nodes', () => {
    const initialState: SharedTreeState = {
      nodes: {
        'parent-1': {
          id: 'parent-1',
          title: 'Parent 1',
          parentId: null,
          orderKey: 'a0',
          hasChildren: true,
          effectiveAccessLevel: 'OWNER',
          isExpanded: true,
          isLoading: false,
          children: ['child-1'],
          childrenLoaded: true,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        'child-1': {
          id: 'child-1',
          title: 'Child 1',
          parentId: 'parent-1',
          orderKey: 'b0',
          hasChildren: false,
          effectiveAccessLevel: 'EDIT',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['parent-1'],
    };

    const state = sharedTreeReducer(initialState, {
      type: 'sharedTree/removeNode',
      payload: 'child-1',
    });

    expect(state.nodes['child-1']).toBeUndefined();
    expect(state.nodes['parent-1'].children).toEqual([]);
    expect(state.nodes['parent-1'].hasChildren).toBe(false);
  });

  it('recursively deletes all descendants when a parent node is removed', () => {
    const initialState: SharedTreeState = {
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
          children: ['child-1'],
          childrenLoaded: true,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        'child-1': {
          id: 'child-1',
          title: 'Child 1',
          parentId: 'root-1',
          orderKey: 'b0',
          hasChildren: true,
          effectiveAccessLevel: 'EDIT',
          isExpanded: true,
          isLoading: false,
          children: ['grandchild-1'],
          childrenLoaded: true,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        'grandchild-1': {
          id: 'grandchild-1',
          title: 'Grandchild 1',
          parentId: 'child-1',
          orderKey: 'c0',
          hasChildren: false,
          effectiveAccessLevel: 'EDIT',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['root-1'],
    };

    const state = sharedTreeReducer(initialState, {
      type: 'sharedTree/removeNode',
      payload: 'root-1',
    });

    expect(state.rootIds).toEqual([]);
    expect(state.nodes['root-1']).toBeUndefined();
    expect(state.nodes['child-1']).toBeUndefined();
    expect(state.nodes['grandchild-1']).toBeUndefined();
    expect(state.nodes).toEqual({});
  });
});

describe('sharedTree.slice moveDocumentThunk.fulfilled', () => {
  it('reorders rootIds by comparing personal orderKeys when moving a root document', () => {
    const initialState: SharedTreeState = {
      nodes: {
        'doc-s1': {
          id: 'doc-s1',
          title: 'Shared 1',
          parentId: null,
          orderKey: 'a0',
          hasChildren: false,
          effectiveAccessLevel: 'OWNER',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        'doc-s2': {
          id: 'doc-s2',
          title: 'Shared 2',
          parentId: null,
          orderKey: 'a2',
          hasChildren: false,
          effectiveAccessLevel: 'OWNER',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        'doc-stm': {
          id: 'doc-stm',
          title: 'Shared To Me',
          parentId: null,
          orderKey: 'a3',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['doc-s1', 'doc-s2', 'doc-stm'],
    };

    // User moved doc-stm between doc-s1 and doc-s2, backend assigned orderKey 'a1'
    const state = sharedTreeReducer(initialState, {
      type: 'sharedTree/moveDocument/fulfilled',
      payload: {
        updatedNode: {
          id: 'doc-stm',
          title: 'Shared To Me',
          parentId: null,
          orderKey: 'a1',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        prevSiblingId: 'doc-s1',
        nextSiblingId: 'doc-s2',
      },
    });

    expect(state.rootIds).toEqual(['doc-s1', 'doc-stm', 'doc-s2']);
    expect(state.nodes['doc-stm'].orderKey).toBe('a1');
  });

  it('preserves existing non-fallback orderKey when syncSharedRoots receives entry without orderKey', () => {
    const previous: SharedTreeState = {
      nodes: {
        'collab-1': {
          id: 'collab-1',
          title: 'collab-1',
          parentId: null,
          orderKey: 'a1',
          hasChildren: false,
          effectiveAccessLevel: 'VIEW',
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        },
      },
      rootIds: ['collab-1'],
    };

    const state = sharedTreeReducer(
      previous,
      syncSharedRoots([entry('collab-1', 'collaborator', null)])
    );

    expect(state.nodes['collab-1'].orderKey).toBe('a1');
  });
});
