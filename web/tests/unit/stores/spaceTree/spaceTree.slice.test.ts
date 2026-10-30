import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import spaceTreeReducer, {
  fetchSpaceChildrenThunk,
  fetchSpaceRootsThunk,
  moveSpaceDocumentThunk,
  removeDocument,
  type SpaceTreeState,
} from '@/stores/spaceTree/spaceTree.slice';
import { documentService } from '../../../../services/document.service';
import type { TreeNode } from '@/types/tree.types';

jest.mock('../../../../services/document.service', () => ({
  documentService: {
    listSpaceRootTreeNodes: jest.fn(),
    listChildTreeNodes: jest.fn(),
    moveDocument: jest.fn(),
  },
}));

const mockedDocumentService = documentService as jest.Mocked<typeof documentService>;

const authStub = (state = { accessToken: 'token-1' }) => state;

function makeStore(preloadedTree?: SpaceTreeState) {
  return configureStore({
    reducer: { spaceTree: spaceTreeReducer, auth: authStub },
    preloadedState: preloadedTree ? { spaceTree: preloadedTree } : undefined,
  });
}

async function dispatchThunk(
  store: { dispatch: (action: UnknownAction) => unknown },
  action: unknown
): Promise<void> {
  await store.dispatch(action as UnknownAction);
}

function treeNode(overrides: Partial<TreeNode> & Pick<TreeNode, 'id' | 'title'>): TreeNode {
  return {
    parentId: null,
    orderKey: 'a0',
    hasChildren: false,
    effectiveAccessLevel: 'EDIT',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    icon: null,
    ...overrides,
  };
}

function page(items: TreeNode[]) {
  return {
    items,
    page: 0,
    size: 100,
    totalElements: items.length,
    totalPages: 1,
    hasMore: false,
  };
}

describe('spaceTree.slice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads a space root document listing into its own tree', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue(
      page([
        treeNode({ id: 'doc-1', title: 'Roadmap', hasChildren: true }),
        treeNode({ id: 'doc-2', title: 'Notes', orderKey: 'a1' }),
      ])
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));

    const tree = store.getState().spaceTree.trees['space-1'];
    expect(mockedDocumentService.listSpaceRootTreeNodes).toHaveBeenCalledWith(
      'token-1',
      'space-1',
      0
    );
    expect(tree.rootIds).toEqual(['doc-1', 'doc-2']);
    expect(tree.nodes['doc-1'].title).toBe('Roadmap');
    expect(tree.isRootLoading).toBe(false);
  });

  it('loads every page of a large space root listing', async () => {
    mockedDocumentService.listSpaceRootTreeNodes
      .mockResolvedValueOnce({
        ...page([treeNode({ id: 'doc-1', title: 'First' })]),
        hasMore: true,
      })
      .mockResolvedValueOnce(page([treeNode({ id: 'doc-2', title: 'Second', orderKey: 'a1' })]));

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));

    expect(mockedDocumentService.listSpaceRootTreeNodes).toHaveBeenNthCalledWith(
      1,
      'token-1',
      'space-1',
      0
    );
    expect(mockedDocumentService.listSpaceRootTreeNodes).toHaveBeenNthCalledWith(
      2,
      'token-1',
      'space-1',
      1
    );
    expect(store.getState().spaceTree.trees['space-1'].rootIds).toEqual(['doc-1', 'doc-2']);
  });

  it('loads every page of a large branch', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValueOnce(
      page([treeNode({ id: 'doc-1', title: 'Roadmap', hasChildren: true })])
    );
    mockedDocumentService.listChildTreeNodes
      .mockResolvedValueOnce({
        ...page([treeNode({ id: 'child-1', title: 'Q3', parentId: 'doc-1' })]),
        hasMore: true,
      })
      .mockResolvedValueOnce(
        page([treeNode({ id: 'child-2', title: 'Q4', parentId: 'doc-1', orderKey: 'a1' })])
      );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));
    await dispatchThunk(store, fetchSpaceChildrenThunk({ spaceId: 'space-1', parentId: 'doc-1' }));

    expect(mockedDocumentService.listChildTreeNodes).toHaveBeenNthCalledWith(
      1,
      'doc-1',
      'token-1',
      0
    );
    expect(mockedDocumentService.listChildTreeNodes).toHaveBeenNthCalledWith(
      2,
      'doc-1',
      'token-1',
      1
    );
    expect(store.getState().spaceTree.trees['space-1'].nodes['doc-1'].children).toEqual([
      'child-1',
      'child-2',
    ]);
  });

  it('keeps loaded sub-documents when the roots refresh and prunes removed roots', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValueOnce(
      page([treeNode({ id: 'doc-1', title: 'Roadmap', hasChildren: true })])
    );
    mockedDocumentService.listChildTreeNodes.mockResolvedValueOnce(
      page([treeNode({ id: 'child-1', title: 'Q3', parentId: 'doc-1' })])
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));
    await dispatchThunk(store, fetchSpaceChildrenThunk({ spaceId: 'space-1', parentId: 'doc-1' }));

    let tree = store.getState().spaceTree.trees['space-1'];
    expect(tree.nodes['doc-1'].children).toEqual(['child-1']);
    expect(tree.nodes['child-1'].parentId).toBe('doc-1');

    // The document was trashed elsewhere: the next refresh drops it and its branch.
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValueOnce(page([]));
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));

    tree = store.getState().spaceTree.trees['space-1'];
    expect(tree.rootIds).toEqual([]);
    expect(tree.nodes['doc-1']).toBeUndefined();
    expect(tree.nodes['child-1']).toBeUndefined();
  });

  it('does not recreate a tree when a background root sync finds none', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue(
      page([treeNode({ id: 'doc-1', title: 'Roadmap' })])
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1', background: true }));

    expect(store.getState().spaceTree.trees['space-1']).toBeUndefined();
  });

  it('marks the parent loading while its children are fetched', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValue(
      page([treeNode({ id: 'doc-1', title: 'Roadmap', hasChildren: true })])
    );
    let resolveChildren: (value: ReturnType<typeof page>) => void = () => {};
    mockedDocumentService.listChildTreeNodes.mockReturnValue(
      new Promise((resolve) => {
        resolveChildren = resolve;
      })
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));
    const pending = dispatchThunk(
      store,
      fetchSpaceChildrenThunk({ spaceId: 'space-1', parentId: 'doc-1' })
    );

    expect(store.getState().spaceTree.trees['space-1'].nodes['doc-1'].isLoading).toBe(true);
    resolveChildren(page([treeNode({ id: 'child-1', title: 'Q3', parentId: 'doc-1' })]));
    await pending;
    expect(store.getState().spaceTree.trees['space-1'].nodes['doc-1'].isLoading).toBe(false);
  });

  it('reorders space roots by the order key the server returns', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValueOnce(
      page([
        treeNode({ id: 'doc-1', title: 'First', orderKey: 'a0' }),
        treeNode({ id: 'doc-2', title: 'Second', orderKey: 'a1' }),
      ])
    );
    mockedDocumentService.moveDocument.mockResolvedValue(
      treeNode({ id: 'doc-1', title: 'First', orderKey: 'a2' })
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));
    await dispatchThunk(
      store,
      moveSpaceDocumentThunk({
        spaceId: 'space-1',
        documentId: 'doc-1',
        newParentId: null,
        prevSiblingId: 'doc-2',
        nextSiblingId: null,
      })
    );

    expect(mockedDocumentService.moveDocument).toHaveBeenCalledWith(
      'doc-1',
      { newParentId: null, prevSiblingId: 'doc-2', nextSiblingId: null },
      'token-1'
    );
    expect(store.getState().spaceTree.trees['space-1'].rootIds).toEqual(['doc-2', 'doc-1']);
  });

  it('reparents a nested document and keeps its root siblings intact', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValueOnce(
      page([treeNode({ id: 'doc-1', title: 'Roadmap', hasChildren: true })])
    );
    mockedDocumentService.listChildTreeNodes.mockResolvedValueOnce(
      page([
        treeNode({ id: 'child-1', title: 'Q3', parentId: 'doc-1' }),
        treeNode({ id: 'child-2', title: 'Q4', parentId: 'doc-1', orderKey: 'a1' }),
      ])
    );
    mockedDocumentService.moveDocument.mockResolvedValue(
      treeNode({ id: 'child-2', title: 'Q4', parentId: 'child-1', orderKey: 'a0' })
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));
    await dispatchThunk(store, fetchSpaceChildrenThunk({ spaceId: 'space-1', parentId: 'doc-1' }));
    await dispatchThunk(
      store,
      moveSpaceDocumentThunk({
        spaceId: 'space-1',
        documentId: 'child-2',
        newParentId: 'child-1',
        prevSiblingId: null,
        nextSiblingId: null,
      })
    );

    const tree = store.getState().spaceTree.trees['space-1'];
    expect(tree.rootIds).toEqual(['doc-1']);
    expect(tree.nodes['doc-1'].children).toEqual(['child-1']);
    expect(tree.nodes['child-1'].children).toEqual(['child-2']);
  });

  it('drops a moved document whose new parent is not loaded in the tree', async () => {
    mockedDocumentService.listSpaceRootTreeNodes.mockResolvedValueOnce(
      page([treeNode({ id: 'doc-1', title: 'Roadmap', hasChildren: true })])
    );
    mockedDocumentService.listChildTreeNodes.mockResolvedValueOnce(
      page([treeNode({ id: 'child-1', title: 'Q3', parentId: 'doc-1' })])
    );
    mockedDocumentService.moveDocument.mockResolvedValue(
      treeNode({ id: 'child-1', title: 'Q3', parentId: 'missing-parent' })
    );

    const store = makeStore();
    await dispatchThunk(store, fetchSpaceRootsThunk({ spaceId: 'space-1' }));
    await dispatchThunk(store, fetchSpaceChildrenThunk({ spaceId: 'space-1', parentId: 'doc-1' }));
    await dispatchThunk(
      store,
      moveSpaceDocumentThunk({
        spaceId: 'space-1',
        documentId: 'child-1',
        newParentId: 'missing-parent',
        prevSiblingId: null,
        nextSiblingId: null,
      })
    );

    const tree = store.getState().spaceTree.trees['space-1'];
    expect(tree.rootIds).toEqual(['doc-1']);
    expect(tree.nodes['doc-1'].children).toEqual([]);
    expect(tree.nodes['child-1']).toBeUndefined();
  });

  it('drops a trashed document from every space tree it appears in', async () => {
    const preloaded: SpaceTreeState = {
      trees: {
        'space-1': {
          nodes: {
            'doc-1': {
              id: 'doc-1',
              title: 'Shared document',
              parentId: null,
              orderKey: 'a0',
              hasChildren: false,
              effectiveAccessLevel: 'EDIT',
              icon: null,
              isExpanded: false,
              isLoading: false,
              children: [],
              childrenLoaded: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
          rootIds: ['doc-1'],
          isRootLoading: false,
        },
        'space-2': {
          nodes: {
            'doc-2': {
              id: 'doc-2',
              title: 'Other',
              parentId: null,
              orderKey: 'a0',
              hasChildren: false,
              effectiveAccessLevel: 'EDIT',
              icon: null,
              isExpanded: false,
              isLoading: false,
              children: [],
              childrenLoaded: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
          rootIds: ['doc-2'],
          isRootLoading: false,
        },
      },
    };

    const store = makeStore(preloaded);
    store.dispatch(removeDocument('doc-1'));

    expect(store.getState().spaceTree.trees['space-1'].rootIds).toEqual([]);
    expect(store.getState().spaceTree.trees['space-2'].rootIds).toEqual(['doc-2']);
  });
});
