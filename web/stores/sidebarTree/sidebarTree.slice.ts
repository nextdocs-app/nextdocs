import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { documentService } from '@/services/document.service';
import { normalizeDocumentTitle } from '@/lib/document-content.util';
import { sanitizeDocumentIcon } from '@/lib/document-icon.util';
import { applyNodeMeta, collectSubtreeIds } from '@/lib/tree-meta.util';
import { getLocalDocumentParents } from '@/lib/local-tree.util';
import { listPendingCloudCreates } from '@/lib/pending-cloud-create.util';
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
    title: normalizeDocumentTitle(node.title),
    parentId: node.parentId,
    orderKey: node.orderKey,
    hasChildren: node.hasChildren,
    effectiveAccessLevel: node.effectiveAccessLevel,
    // Tree nodes feed the sidebar icon render; re-validate so stale IndexedDB
    // or a compromised payload degrades to no icon instead of reaching img/CSS.
    icon: sanitizeDocumentIcon(node.icon) ?? null,
    isExpanded,
    isLoading: false,
    children: [],
    childrenLoaded: false,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function buildLocalTreeNodes(
  docs: {
    id: string;
    meta: { title: string; icon?: unknown; createdAt: string; updatedAt: string };
  }[],
  parents: ReadonlyMap<string, string | null>
): TreeNode[] {
  const localIds = new Set(docs.map((doc) => doc.id));
  const childCounts = new Map<string, number>();
  for (const [id, parentId] of parents) {
    // The cache now covers cloud documents that may never have been opened on
    // this device. Only cached children can be rendered, so only those should
    // make their parent look expandable offline.
    if (parentId && localIds.has(id)) {
      childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
    }
  }

  return docs.map((doc, index) => ({
    id: doc.id,
    title: normalizeDocumentTitle(doc.meta.title),
    parentId: parents.get(doc.id) ?? null,
    orderKey: makeLocalOrderKey(index),
    hasChildren: (childCounts.get(doc.id) ?? 0) > 0,
    effectiveAccessLevel: 'OWNER',
    createdAt: doc.meta.createdAt,
    updatedAt: doc.meta.updatedAt,
    icon: sanitizeDocumentIcon(doc.meta.icon) ?? null,
  }));
}

function sortRootIds(state: SidebarTreeState): void {
  state.rootIds.sort((aId, bId) =>
    compareOrderKeys(state.nodes[aId]?.orderKey ?? '', state.nodes[bId]?.orderKey ?? '')
  );
}

function detachNode(state: SidebarTreeState, id: string): void {
  const node = state.nodes[id];
  if (!node) {
    return;
  }

  if (node.parentId && state.nodes[node.parentId]) {
    state.nodes[node.parentId].children = state.nodes[node.parentId].children.filter(
      (childId) => childId !== id
    );
  } else {
    state.rootIds = state.rootIds.filter((rootId) => rootId !== id);
  }
  node.parentId = null;
}

/**
 * Merges a local-only tree into the one already on screen. Cloud documents are
 * absent from the local payload, so replacing the roots would erase them; and
 * a local child must attach to its parent instead of surfacing at the root.
 */
function mergeDegradedLocalNodes(state: SidebarTreeState, rawNodes: TreeNode[]): void {
  const freshIds = new Set<string>();

  // First pass: materialize every local node. Local listings are ordered by
  // updatedAt, so a freshly created child is merged before its parent exists;
  // placing nodes in this pass would root the child permanently.
  for (const rawNode of rawNodes) {
    const existing = state.nodes[rawNode.id];
    if (existing) {
      existing.title = normalizeDocumentTitle(rawNode.title);
      existing.icon = sanitizeDocumentIcon(rawNode.icon) ?? null;
      existing.createdAt = rawNode.createdAt;
      existing.updatedAt = rawNode.updatedAt;
      existing.hasChildren = existing.hasChildren || rawNode.hasChildren;
      continue;
    }

    freshIds.add(rawNode.id);
    state.nodes[rawNode.id] = toSidebarTreeNode({ ...rawNode, parentId: null });
  }

  // Second pass: attach each node under its parent. A parent that is neither in
  // the local payload nor on screen (e.g. a document only known to the cloud)
  // degrades to the root so the document stays reachable.
  for (const rawNode of rawNodes) {
    const node = state.nodes[rawNode.id];
    if (!node) {
      continue;
    }

    // A null parentId only proves "no locally recorded parent". Cached copies
    // of nested cloud documents are in the payload without a local link, so
    // their placement must survive instead of being re-rooted.
    if (!freshIds.has(node.id) && rawNode.parentId === null) {
      continue;
    }

    const parentId = rawNode.parentId && state.nodes[rawNode.parentId] ? rawNode.parentId : null;
    if (node.parentId !== parentId) {
      detachNode(state, node.id);
      node.parentId = parentId;
    }

    if (parentId) {
      const parent = state.nodes[parentId];
      parent.hasChildren = true;
      parent.isExpanded = true;
      if (!parent.children.includes(node.id)) {
        parent.children.push(node.id);
      }
      parent.children.sort((aId, bId) =>
        compareOrderKeys(state.nodes[aId]?.orderKey ?? '', state.nodes[bId]?.orderKey ?? '')
      );
    } else if (!state.rootIds.includes(node.id)) {
      state.rootIds.push(node.id);
    }
  }

  sortRootIds(state);
}

export const fetchRootNodesThunk = createAsyncThunk<
  {
    nodes: TreeNode[];
    hasMore: boolean;
    page: number;
    degradedToLocal?: boolean;
    pendingLocalNodes?: TreeNode[];
  },
  { page?: number; size?: number; append?: boolean; background?: boolean } | undefined,
  { state: RootState }
>('sidebarTree/fetchRootNodes', async (params, { getState }) => {
  const state = getState();
  const { accessToken } = state.auth;
  const page = params?.page ?? 0;
  const size = params?.size ?? 50;

  if (!accessToken) {
    // Signed-out users only get the Shared section (share-link documents).
    // Private local documents are no longer created for guests, so there is
    // nothing of theirs to list here.
    return { nodes: [], hasMore: false, page: 0 };
  }

  const userId = state.auth.user?.id;

  try {
    const result = await documentService.listRootTreeNodes(accessToken, page, size);

    if (page === 0 && userId) {
      // Tree fetches only cover visible branches. Cache the full private
      // hierarchy in the background so cached subpages keep their nesting
      // after an offline reload, even if the branch was never expanded.
      // Deferred so a warmer failure can never turn a successful tree load
      // into the degraded local fallback.
      void Promise.resolve()
        .then(() => documentService.cachePrivateHierarchy(accessToken, userId))
        .catch((error) => {
          console.warn('Failed to cache document hierarchy for offline use:', error);
        });
    }

    // Documents created offline have no cloud row yet, so the cloud roots do
    // not list them. Merge those local copies so they stay visible until the
    // queued create lands (and if it never does).
    let pendingLocalNodes: TreeNode[] | undefined;
    if (userId) {
      const pendingIds = new Set(listPendingCloudCreates(userId).map((entry) => entry.id));
      if (pendingIds.size > 0) {
        const localDocs = (await documentService.getAllDocumentsMeta()).filter(
          (doc) => pendingIds.has(doc.id) && !doc.meta.deletedAt
        );
        if (localDocs.length > 0) {
          pendingLocalNodes = buildLocalTreeNodes(localDocs, getLocalDocumentParents());
        }
      }
    }

    return {
      nodes: result.items,
      hasMore: result.hasMore,
      page: result.page,
      pendingLocalNodes,
    };
  } catch (err) {
    console.warn('Failed to fetch cloud tree nodes, falling back to local documents:', err);
    const localDocs = await documentService.getAllDocumentsMeta();
    const activeLocalDocs = localDocs.filter((d) => !d.meta.deletedAt);
    return {
      nodes: buildLocalTreeNodes(activeLocalDocs, getLocalDocumentParents()),
      hasMore: false,
      page: 0,
      degradedToLocal: true,
    };
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

    updateNodeMeta(
      state,
      action: PayloadAction<{ id: string; title?: string; icon?: SidebarTreeNode['icon'] }>
    ) {
      const node = state.nodes[action.payload.id];
      if (node) {
        applyNodeMeta(node, { title: action.payload.title, icon: action.payload.icon });
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

      const toDelete = collectSubtreeIds(state.nodes, id);

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
      .addCase(fetchRootNodesThunk.pending, (state, action) => {
        const arg = action.meta.arg;
        if (arg?.background) {
          return;
        }
        if (arg?.append) {
          state.isRootLoading = true;
          return;
        }
        if (state.rootIds.length === 0) {
          state.isRootLoading = true;
        }
      })
      .addCase(fetchRootNodesThunk.fulfilled, (state, action) => {
        // Background syncs never touched isRootLoading, so they must not clear
        // it either (a background success must not hide a foreground initial
        // load's skeleton early).
        if (!action.meta.arg?.background) {
          state.isRootLoading = false;
        }
        state.rootHasMore = action.payload.hasMore;
        state.rootPage = action.payload.page;

        if (action.payload.degradedToLocal) {
          mergeDegradedLocalNodes(state, action.payload.nodes);
          return;
        }

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

        if (action.payload.pendingLocalNodes?.length) {
          mergeDegradedLocalNodes(state, action.payload.pendingLocalNodes);
        }
      })
      .addCase(fetchRootNodesThunk.rejected, (state, action) => {
        if (!action.meta.arg?.background) {
          state.isRootLoading = false;
        }
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
