import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { documentService } from '@/services/document.service';
import { applyNodeMeta, collectSubtreeIds, pruneUnreachableNodes } from '@/lib/tree-meta.util';
import { compareOrderKeys, toSidebarTreeNode } from '../sidebarTree/sidebarTree.slice';
import type { RootState } from '../store';
import type { SidebarTreeNode, TreeNode } from '@/types/tree.types';

/**
 * One tree per space, keyed by space id: spaces expand independently, and a
 * drag may only move documents inside the space it started in.
 */
export interface SpaceTree {
  nodes: Record<string, SidebarTreeNode>;
  rootIds: string[];
  isRootLoading: boolean;
}

export interface SpaceTreeState {
  trees: Record<string, SpaceTree>;
}

const initialState: SpaceTreeState = {
  trees: {},
};

function emptyTree(): SpaceTree {
  return { nodes: {}, rootIds: [], isRootLoading: false };
}

function ensureTree(state: SpaceTreeState, spaceId: string): SpaceTree {
  let tree = state.trees[spaceId];
  if (!tree) {
    tree = emptyTree();
    state.trees[spaceId] = tree;
  }
  return tree;
}

/**
 * Merges a refreshed root listing into a tree that may already hold loaded
 * branches. Children are kept so collapsing and re-expanding a space does not
 * throw away sub-documents the reader already opened.
 */
function mergeRoots(tree: SpaceTree, roots: TreeNode[]): void {
  for (const rawRoot of roots) {
    const existing = tree.nodes[rawRoot.id];
    tree.nodes[rawRoot.id] = toSidebarTreeNode(rawRoot, existing?.isExpanded ?? false);
    if (existing) {
      tree.nodes[rawRoot.id].children = existing.children;
      tree.nodes[rawRoot.id].childrenLoaded = existing.childrenLoaded;
    }
  }

  tree.rootIds = roots.map((root) => root.id);
  // A document trashed, detached, or moved elsewhere leaves the listing; drop the
  // subtree it dragged along instead of keeping unreachable rows in memory.
  pruneUnreachableNodes(tree.nodes, tree.rootIds);
}

function sortRootIds(tree: SpaceTree): void {
  tree.rootIds.sort((aId, bId) =>
    compareOrderKeys(tree.nodes[aId]?.orderKey ?? '', tree.nodes[bId]?.orderKey ?? '')
  );
}

function detachNode(tree: SpaceTree, id: string): SidebarTreeNode | null {
  const node = tree.nodes[id];
  if (!node) {
    return null;
  }

  if (node.parentId && tree.nodes[node.parentId]) {
    const parent = tree.nodes[node.parentId];
    parent.children = parent.children.filter((childId) => childId !== id);
    parent.hasChildren = parent.children.length > 0;
  } else {
    tree.rootIds = tree.rootIds.filter((rootId) => rootId !== id);
  }

  return node;
}

export const fetchSpaceRootsThunk = createAsyncThunk<
  { spaceId: string; nodes: TreeNode[] },
  { spaceId: string; background?: boolean },
  { state: RootState }
>('spaceTree/fetchRoots', async ({ spaceId }, { getState }) => {
  const { accessToken } = getState().auth;
  if (!accessToken) {
    return { spaceId, nodes: [] };
  }

  // A space can hold more roots than one page; a partial tree would silently hide
  // documents the reader can open from elsewhere. Pages arrive in order-key order.
  const nodes: TreeNode[] = [];
  for (let page = 0; ; page += 1) {
    const result = await documentService.listSpaceRootTreeNodes(accessToken, spaceId, page);
    nodes.push(...result.items);
    if (!result.hasMore || result.items.length === 0) {
      break;
    }
  }
  return { spaceId, nodes };
});

export const fetchSpaceChildrenThunk = createAsyncThunk<
  { spaceId: string; parentId: string; children: TreeNode[] },
  { spaceId: string; parentId: string },
  { state: RootState }
>('spaceTree/fetchChildren', async ({ spaceId, parentId }, { getState }) => {
  const { accessToken } = getState().auth;
  if (!accessToken) {
    return { spaceId, parentId, children: [] };
  }

  const children: TreeNode[] = [];
  for (let page = 0; ; page += 1) {
    const result = await documentService.listChildTreeNodes(parentId, accessToken, page);
    children.push(...result.items);
    if (!result.hasMore || result.items.length === 0) {
      break;
    }
  }
  return { spaceId, parentId, children };
});

export const moveSpaceDocumentThunk = createAsyncThunk<
  { spaceId: string; updatedNode: TreeNode },
  {
    spaceId: string;
    documentId: string;
    newParentId: string | null;
    prevSiblingId: string | null;
    nextSiblingId: string | null;
  },
  { state: RootState }
>(
  'spaceTree/moveDocument',
  async ({ spaceId, documentId, newParentId, prevSiblingId, nextSiblingId }, { getState }) => {
    const { accessToken } = getState().auth;
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const updatedNode = await documentService.moveDocument(
      documentId,
      { newParentId, prevSiblingId, nextSiblingId },
      accessToken
    );
    return { spaceId, updatedNode };
  }
);

const spaceTreeSlice = createSlice({
  name: 'spaceTree',
  initialState,
  reducers: {
    toggleNodeExpanded(state, action: PayloadAction<{ spaceId: string; nodeId: string }>) {
      const { spaceId, nodeId } = action.payload;
      const node = state.trees[spaceId]?.nodes[nodeId];
      if (node) {
        node.isExpanded = !node.isExpanded;
      }
    },

    setNodeExpanded(
      state,
      action: PayloadAction<{ spaceId: string; nodeId: string; expanded: boolean }>
    ) {
      const { spaceId, nodeId, expanded } = action.payload;
      const node = state.trees[spaceId]?.nodes[nodeId];
      if (node) {
        node.isExpanded = expanded;
      }
    },

    /**
     * Title/icon fan-out reaches every space tree; the payload carries no space
     * id because a document can be open in the editor regardless of which group is
     * expanded, and an unknown id is simply ignored.
     */
    updateNodeMeta(
      state,
      action: PayloadAction<{ id: string; title?: string; icon?: SidebarTreeNode['icon'] }>
    ) {
      const { id, title, icon } = action.payload;
      for (const tree of Object.values(state.trees)) {
        const node = tree.nodes[id];
        if (node) {
          applyNodeMeta(node, { title, icon });
        }
      }
    },

    removeNode(state, action: PayloadAction<{ spaceId: string; nodeId: string }>) {
      const { spaceId, nodeId } = action.payload;
      const tree = state.trees[spaceId];
      if (!tree) {
        return;
      }

      detachNode(tree, nodeId);
      for (const deleteId of collectSubtreeIds(tree.nodes, nodeId)) {
        delete tree.nodes[deleteId];
      }
    },

    /** A document left every space tree (trashed, detached, or deleted elsewhere). */
    removeDocument(state, action: PayloadAction<string>) {
      const documentId = action.payload;
      for (const tree of Object.values(state.trees)) {
        if (!tree.nodes[documentId]) {
          continue;
        }
        detachNode(tree, documentId);
        for (const deleteId of collectSubtreeIds(tree.nodes, documentId)) {
          delete tree.nodes[deleteId];
        }
      }
    },

    resetTree(state, action: PayloadAction<string>) {
      delete state.trees[action.payload];
    },

    resetAllTrees(state) {
      state.trees = {};
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSpaceRootsThunk.pending, (state, action) => {
        if (action.meta.arg.background) {
          return;
        }
        ensureTree(state, action.meta.arg.spaceId).isRootLoading = true;
      })
      .addCase(fetchSpaceRootsThunk.fulfilled, (state, action) => {
        const tree = state.trees[action.payload.spaceId];
        // A background sync or a response that outlived resetTree must not resurrect
        // a tree nobody shows any more.
        if (!tree) {
          return;
        }
        tree.isRootLoading = false;
        mergeRoots(tree, action.payload.nodes);
      })
      .addCase(fetchSpaceRootsThunk.rejected, (state, action) => {
        const tree = state.trees[action.meta.arg.spaceId];
        if (tree) {
          tree.isRootLoading = false;
        }
      })
      .addCase(fetchSpaceChildrenThunk.pending, (state, action) => {
        const { spaceId, parentId } = action.meta.arg;
        const parent = state.trees[spaceId]?.nodes[parentId];
        if (parent) {
          parent.isLoading = true;
        }
      })
      .addCase(fetchSpaceChildrenThunk.fulfilled, (state, action) => {
        const { spaceId, parentId, children } = action.payload;
        const parent = state.trees[spaceId]?.nodes[parentId];
        if (!parent) {
          return;
        }

        parent.isLoading = false;
        parent.childrenLoaded = true;
        parent.hasChildren = children.length > 0;

        const childIds: string[] = [];
        for (const rawChild of children) {
          childIds.push(rawChild.id);
          const existing = state.trees[spaceId].nodes[rawChild.id];
          state.trees[spaceId].nodes[rawChild.id] = toSidebarTreeNode(
            rawChild,
            existing?.isExpanded ?? false
          );
          if (existing) {
            state.trees[spaceId].nodes[rawChild.id].children = existing.children;
            state.trees[spaceId].nodes[rawChild.id].childrenLoaded = existing.childrenLoaded;
          }
        }
        parent.children = childIds;
      })
      .addCase(fetchSpaceChildrenThunk.rejected, (state, action) => {
        const { spaceId, parentId } = action.meta.arg;
        const parent = state.trees[spaceId]?.nodes[parentId];
        if (parent) {
          parent.isLoading = false;
        }
      })
      .addCase(moveSpaceDocumentThunk.fulfilled, (state, action) => {
        const { spaceId, updatedNode } = action.payload;
        const tree = state.trees[spaceId];
        if (!tree) {
          return;
        }

        const existing = tree.nodes[updatedNode.id];
        const wasExpanded = existing?.isExpanded ?? false;
        detachNode(tree, updatedNode.id);

        tree.nodes[updatedNode.id] = toSidebarTreeNode(updatedNode, wasExpanded);
        if (existing) {
          tree.nodes[updatedNode.id].children = existing.children;
          tree.nodes[updatedNode.id].childrenLoaded = existing.childrenLoaded;
        }

        if (updatedNode.parentId && tree.nodes[updatedNode.parentId]) {
          const parent = tree.nodes[updatedNode.parentId];
          parent.hasChildren = true;
          parent.isExpanded = true;
          if (!parent.children.includes(updatedNode.id)) {
            parent.children.push(updatedNode.id);
          }
          parent.children.sort((aId, bId) =>
            compareOrderKeys(tree.nodes[aId]?.orderKey ?? '', tree.nodes[bId]?.orderKey ?? '')
          );
        } else if (updatedNode.parentId === null) {
          if (!tree.rootIds.includes(updatedNode.id)) {
            tree.rootIds.push(updatedNode.id);
          }
          sortRootIds(tree);
        } else {
          // The new parent is not part of the loaded tree, so the row has no place to
          // render; promoting it to a root would show the wrong hierarchy.
          for (const deleteId of collectSubtreeIds(tree.nodes, updatedNode.id)) {
            delete tree.nodes[deleteId];
          }
        }
      });
  },
});

export const {
  toggleNodeExpanded,
  setNodeExpanded,
  updateNodeMeta,
  removeNode,
  removeDocument,
  resetTree,
  resetAllTrees,
} = spaceTreeSlice.actions;

export default spaceTreeSlice.reducer;
