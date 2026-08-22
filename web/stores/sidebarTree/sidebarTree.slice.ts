import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { documentService } from '@/services/document.service';
import type { RootState } from '../store';
import type { SidebarTreeNode, TreeNode, MoveDocumentRequest } from '@/types/tree.types';

export interface SidebarTreeState {
  nodes: Record<string, SidebarTreeNode>;
  rootIds: string[];
  isRootLoading: boolean;
  rootHasMore: boolean;
  rootPage: number;
}

const initialState: SidebarTreeState = {
  nodes: {},
  rootIds: [],
  isRootLoading: false,
  rootHasMore: false,
  rootPage: 0,
};

function compareOrderKeys(keyA: string, keyB: string): number {
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}

export { compareOrderKeys };

function makeLocalOrderKey(index: number): string {
  return `a${String(index).padStart(4, '0')}`;
}

export function toSidebarTreeNode(node: TreeNode, isExpanded = false): SidebarTreeNode {
  return {
    id: node.id,
    title: node.title || 'Untitled',
    parentId: node.parentId,
    orderKey: node.orderKey,
    hasChildren: node.hasChildren,
    effectiveAccessLevel: node.effectiveAccessLevel,
    isExpanded,
    isLoading: false,
    children: [],
    childrenLoaded: false,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

export const fetchRootNodesThunk = createAsyncThunk<
  { nodes: TreeNode[]; hasMore: boolean; page: number },
  { page?: number; size?: number; append?: boolean } | undefined,
  { state: RootState }
>('sidebarTree/fetchRootNodes', async (params, { getState }) => {
  const state = getState();
  const { accessToken } = state.auth;
  const page = params?.page ?? 0;
  const size = params?.size ?? 50;

  if (!accessToken) {
    const localDocs = await documentService.getAllDocumentsMeta();
    const activeLocalDocs = localDocs.filter((d) => !d.meta.deletedAt);
    const nodes: TreeNode[] = activeLocalDocs.map((d, index) => ({
      id: d.id,
      title: d.meta.title || 'Untitled',
      parentId: null,
      orderKey: makeLocalOrderKey(index),
      hasChildren: false,
      effectiveAccessLevel: 'OWNER',
      createdAt: d.meta.createdAt,
      updatedAt: d.meta.updatedAt,
    }));
    return { nodes, hasMore: false, page: 0 };
  }

  try {
    const result = await documentService.listRootTreeNodes(accessToken, page, size);
    return {
      nodes: result.items,
      hasMore: result.hasMore,
      page: result.page,
    };
  } catch (err) {
    console.warn('Failed to fetch cloud tree nodes, falling back to local documents:', err);
    const localDocs = await documentService.getAllDocumentsMeta();
    const activeLocalDocs = localDocs.filter((d) => !d.meta.deletedAt);
    const nodes: TreeNode[] = activeLocalDocs.map((d, index) => ({
      id: d.id,
      title: d.meta.title || 'Untitled',
      parentId: null,
      orderKey: makeLocalOrderKey(index),
      hasChildren: false,
      effectiveAccessLevel: 'OWNER',
      createdAt: d.meta.createdAt,
      updatedAt: d.meta.updatedAt,
    }));
    return { nodes, hasMore: false, page: 0 };
  }
});

export const fetchChildrenThunk = createAsyncThunk<
  { parentId: string; children: TreeNode[] },
  { parentId: string },
  { state: RootState }
>('sidebarTree/fetchChildren', async ({ parentId }, { getState }) => {
  const state = getState();
  const { accessToken } = state.auth;
  if (!accessToken) {
    return { parentId, children: [] };
  }

  const result = await documentService.listChildTreeNodes(parentId, accessToken, 0, 50);
  return {
    parentId,
    children: result.items,
  };
});

export const moveDocumentThunk = createAsyncThunk<
  { updatedNode: TreeNode },
  {
    documentId: string;
    newParentId: string | null;
    prevSiblingId: string | null;
    nextSiblingId: string | null;
  },
  { state: RootState }
>(
  'sidebarTree/moveDocument',
  async ({ documentId, newParentId, prevSiblingId, nextSiblingId }, { getState }) => {
    const state = getState();
    const { accessToken } = state.auth;
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const request: MoveDocumentRequest = {
      newParentId,
      prevSiblingId,
      nextSiblingId,
    };

    const updatedNode = await documentService.moveDocument(documentId, request, accessToken);
    return { updatedNode };
  }
);

const sidebarTreeSlice = createSlice({
  name: 'sidebarTree',
  initialState,
  reducers: {
    toggleExpanded(state, action: PayloadAction<string>) {
      const id = action.payload;
      const node = state.nodes[id];
      if (node) {
        node.isExpanded = !node.isExpanded;
      }
    },

    setNodeExpanded(state, action: PayloadAction<{ id: string; expanded: boolean }>) {
      const { id, expanded } = action.payload;
      const node = state.nodes[id];
      if (node) {
        node.isExpanded = expanded;
      }
    },

    updateNodeMeta(state, action: PayloadAction<{ id: string; title?: string }>) {
      const { id, title } = action.payload;
      const node = state.nodes[id];
      if (node) {
        if (title !== undefined) {
          node.title = title || 'Untitled';
        }
      }
    },

    addNode(state, action: PayloadAction<TreeNode>) {
      const newNode = toSidebarTreeNode(action.payload);
      state.nodes[newNode.id] = newNode;

      if (newNode.parentId && state.nodes[newNode.parentId]) {
        const parent = state.nodes[newNode.parentId];
        parent.hasChildren = true;
        if (!parent.children.includes(newNode.id)) {
          parent.children.push(newNode.id);
        }
        parent.isExpanded = true;
        parent.children.sort((aId, bId) => {
          const keyA = state.nodes[aId]?.orderKey ?? '';
          const keyB = state.nodes[bId]?.orderKey ?? '';
          return compareOrderKeys(keyA, keyB);
        });
      } else if (!newNode.parentId) {
        if (!state.rootIds.includes(newNode.id)) {
          state.rootIds.push(newNode.id);
        }
        state.rootIds.sort((aId, bId) => {
          const keyA = state.nodes[aId]?.orderKey ?? '';
          const keyB = state.nodes[bId]?.orderKey ?? '';
          return compareOrderKeys(keyA, keyB);
        });
      }
    },

    removeNode(state, action: PayloadAction<string>) {
      const id = action.payload;
      const node = state.nodes[id];
      if (!node) return;

      if (node.parentId && state.nodes[node.parentId]) {
        const parent = state.nodes[node.parentId];
        parent.children = parent.children.filter((childId) => childId !== id);
        if (parent.children.length === 0) {
          parent.hasChildren = false;
        }
      } else {
        state.rootIds = state.rootIds.filter((rootId) => rootId !== id);
      }

      const toDelete = [id];
      const queue = [id];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentNode = state.nodes[currentId];
        if (currentNode?.children) {
          for (const childId of currentNode.children) {
            toDelete.push(childId);
            queue.push(childId);
          }
        }
      }

      for (const deleteId of toDelete) {
        delete state.nodes[deleteId];
      }
    },

    resetTree(state) {
      state.nodes = {};
      state.rootIds = [];
      state.isRootLoading = false;
      state.rootHasMore = false;
      state.rootPage = 0;
    },
  },
  extraReducers: (builder) => {
    // fetchRootNodesThunk
    builder
      .addCase(fetchRootNodesThunk.pending, (state) => {
        state.isRootLoading = true;
      })
      .addCase(fetchRootNodesThunk.fulfilled, (state, action) => {
        state.isRootLoading = false;
        state.rootHasMore = action.payload.hasMore;
        state.rootPage = action.payload.page;

        const newRootIds: string[] = [];
        for (const rawNode of action.payload.nodes) {
          newRootIds.push(rawNode.id);
          const existing = state.nodes[rawNode.id];
          state.nodes[rawNode.id] = toSidebarTreeNode(
            rawNode,
            existing ? existing.isExpanded : false
          );
          if (existing) {
            state.nodes[rawNode.id].children = existing.children;
            state.nodes[rawNode.id].childrenLoaded = existing.childrenLoaded;
          }
        }

        if (action.meta.arg?.append) {
          // Pagination: keep the current (drag) root order and append roots
          // from the next page that are not already loaded.
          const existingSet = new Set(state.rootIds);
          state.rootIds = [...state.rootIds, ...newRootIds.filter((id) => !existingSet.has(id))];
        } else {
          state.rootIds = newRootIds;
        }
      })
      .addCase(fetchRootNodesThunk.rejected, (state) => {
        state.isRootLoading = false;
      });

    // fetchChildrenThunk
    builder
      .addCase(fetchChildrenThunk.pending, (state, action) => {
        const parentId = action.meta.arg.parentId;
        if (state.nodes[parentId]) {
          state.nodes[parentId].isLoading = true;
        }
      })
      .addCase(fetchChildrenThunk.fulfilled, (state, action) => {
        const { parentId, children } = action.payload;
        const parent = state.nodes[parentId];
        if (parent) {
          parent.isLoading = false;
          parent.childrenLoaded = true;
          parent.hasChildren = children.length > 0;

          const childIds: string[] = [];
          for (const rawChild of children) {
            childIds.push(rawChild.id);
            const existing = state.nodes[rawChild.id];
            state.nodes[rawChild.id] = toSidebarTreeNode(
              rawChild,
              existing ? existing.isExpanded : false
            );
            if (existing) {
              state.nodes[rawChild.id].children = existing.children;
              state.nodes[rawChild.id].childrenLoaded = existing.childrenLoaded;
            }
          }
          parent.children = childIds;
        }
      })
      .addCase(fetchChildrenThunk.rejected, (state, action) => {
        const parentId = action.meta.arg.parentId;
        if (state.nodes[parentId]) {
          state.nodes[parentId].isLoading = false;
        }
      });

    // moveDocumentThunk
    builder.addCase(moveDocumentThunk.fulfilled, (state, action) => {
      const { updatedNode } = action.payload;
      const existing = state.nodes[updatedNode.id];
      const oldParentId = existing?.parentId ?? null;
      const newParentId = updatedNode.parentId;

      // Remove from old location
      if (oldParentId && state.nodes[oldParentId]) {
        const oldParent = state.nodes[oldParentId];
        oldParent.children = oldParent.children.filter((cid) => cid !== updatedNode.id);
        if (oldParent.children.length === 0) {
          oldParent.hasChildren = false;
        }
      } else if (!oldParentId) {
        state.rootIds = state.rootIds.filter((rid) => rid !== updatedNode.id);
      }

      // Add to new location
      state.nodes[updatedNode.id] = toSidebarTreeNode(
        updatedNode,
        existing ? existing.isExpanded : false
      );
      if (existing) {
        state.nodes[updatedNode.id].children = existing.children;
        state.nodes[updatedNode.id].childrenLoaded = existing.childrenLoaded;
      }

      if (newParentId && state.nodes[newParentId]) {
        const newParent = state.nodes[newParentId];
        newParent.hasChildren = true;
        if (!newParent.children.includes(updatedNode.id)) {
          newParent.children.push(updatedNode.id);
        }
        newParent.isExpanded = true;
        newParent.children.sort((aId, bId) => {
          const keyA = state.nodes[aId]?.orderKey ?? '';
          const keyB = state.nodes[bId]?.orderKey ?? '';
          return compareOrderKeys(keyA, keyB);
        });
      } else if (!newParentId) {
        if (!state.rootIds.includes(updatedNode.id)) {
          state.rootIds.push(updatedNode.id);
        }
        state.rootIds.sort((aId, bId) => {
          const keyA = state.nodes[aId]?.orderKey ?? '';
          const keyB = state.nodes[bId]?.orderKey ?? '';
          return compareOrderKeys(keyA, keyB);
        });
      }
    });
  },
});

export const { toggleExpanded, setNodeExpanded, updateNodeMeta, addNode, removeNode, resetTree } =
  sidebarTreeSlice.actions;

export default sidebarTreeSlice.reducer;
