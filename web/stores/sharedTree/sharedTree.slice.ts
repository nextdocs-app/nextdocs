import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { documentService } from '@/services/document.service';
import type { RootState } from '../store';
import type { SidebarTreeNode, TreeNode, MoveDocumentRequest } from '@/types/tree.types';
import type { SharedDocumentEntry } from '../documentList/documentList.types';
import { compareOrderKeys, toSidebarTreeNode } from '../sidebarTree/sidebarTree.slice';
import { normalizeDocumentTitle } from '@/lib/document-content.util';

export interface SharedTreeState {
  nodes: Record<string, SidebarTreeNode>;
  rootIds: string[];
}

const initialState: SharedTreeState = {
  nodes: {},
  rootIds: [],
};

export interface MoveDocumentArgs {
  documentId: string;
  newParentId: string | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
}

export const fetchChildrenThunk = createAsyncThunk<
  { parentId: string; children: TreeNode[] },
  { parentId: string },
  { state: RootState }
>('sharedTree/fetchChildren', async ({ parentId }, { getState }) => {
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

export const fetchPublicChildrenThunk = createAsyncThunk<
  { parentId: string; children: TreeNode[] },
  { parentId: string },
  { state: RootState }
>('sharedTree/fetchPublicChildren', async ({ parentId }) => {
  const allChildren: TreeNode[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < 10) {
    const result = await documentService.listPublicChildren(parentId, page, 50);
    allChildren.push(...result.items);
    hasMore = result.hasMore;
    page += 1;
  }

  return {
    parentId,
    children: allChildren,
  };
});

export const moveDocumentThunk = createAsyncThunk<
  { updatedNode: TreeNode; prevSiblingId: string | null; nextSiblingId: string | null },
  MoveDocumentArgs,
  { state: RootState }
>(
  'sharedTree/moveDocument',
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
    return { updatedNode, prevSiblingId, nextSiblingId };
  }
);

function applyFetchedChildren(
  state: SharedTreeState,
  payload: { parentId: string; children: TreeNode[] }
) {
  const { parentId, children } = payload;
  const parent = state.nodes[parentId];
  if (!parent) return;

  parent.isLoading = false;
  parent.childrenLoaded = true;
  parent.hasChildren = children.length > 0;

  const childIds: string[] = [];
  for (const rawChild of children) {
    childIds.push(rawChild.id);
    const existing = state.nodes[rawChild.id];
    state.nodes[rawChild.id] = toSidebarTreeNode(rawChild, existing ? existing.isExpanded : false);
    if (existing) {
      state.nodes[rawChild.id].children = existing.children;
      state.nodes[rawChild.id].childrenLoaded = existing.childrenLoaded;
    }
  }
  parent.children = childIds;
}

const sharedTreeSlice = createSlice({
  name: 'sharedTree',
  initialState,
  reducers: {
    toggleExpanded(state, action: PayloadAction<string>) {
      const id = action.payload;
      const node = state.nodes[id];
      if (node) {
        node.isExpanded = !node.isExpanded;
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
    },

    updateNodeMeta(state, action: PayloadAction<{ id: string; title?: string }>) {
      const { id, title } = action.payload;
      const node = state.nodes[id];
      if (node) {
        if (title !== undefined) {
          node.title = normalizeDocumentTitle(title);
        }
      }
    },

    /**
     * Guest (anonymous share-link) roots. Nodes come from public breadcrumbs /
     * public children endpoints which already enforce effective public access
     * (own or inherited links), so no relationship/ordering metadata applies.
     * Expansion and previously fetched children are preserved across syncs.
     */
    syncPublicRoots(state, action: PayloadAction<TreeNode[]>) {
      const entries = action.payload;
      const entryIds = new Set(entries.map((entry) => entry.id));

      // Public endpoints can report a real parentId whose node is not visible
      // (e.g. a breadcrumb chain truncated at a private ancestor, or a child
      // response whose parent is outside the fetched page). Those documents
      // have to float as roots: only parentId==null roots would leave them
      // unreachable, and the sweep below would delete them.
      const isDanglingParent = (entry: TreeNode) =>
        entry.parentId != null && !entryIds.has(entry.parentId);
      const rootIds = entries
        .filter((entry) => entry.parentId == null || isDanglingParent(entry))
        .map((entry) => entry.id);

      for (const entry of entries) {
        const existing = state.nodes[entry.id];
        state.nodes[entry.id] = toSidebarTreeNode(
          isDanglingParent(entry) ? { ...entry, parentId: null } : entry,
          existing?.isExpanded ?? false
        );
        if (existing) {
          state.nodes[entry.id].children = existing.children;
          state.nodes[entry.id].childrenLoaded = existing.childrenLoaded;
          if (existing.children.length > 0) {
            state.nodes[entry.id].hasChildren = true;
          }
        }
      }

      // Link breadcrumb chains (child-before-parent ordering does not matter).
      for (const entry of entries) {
        if (entry.parentId == null || !entryIds.has(entry.parentId)) {
          continue;
        }
        const parentNode = state.nodes[entry.parentId];
        if (!parentNode) {
          continue;
        }
        parentNode.hasChildren = true;
        if (!parentNode.children.includes(entry.id)) {
          parentNode.children.push(entry.id);
        }
      }

      state.rootIds = rootIds.filter((id) => state.nodes[id]);

      // Prune nodes that are no longer reachable from the roots, except keep
      // previously fetched children of surviving nodes (lazy-loaded subtrees).
      const reachable = new Set<string>(state.rootIds);
      const queue = [...state.rootIds];
      while (queue.length > 0) {
        const id = queue.shift()!;
        const node = state.nodes[id];
        if (!node) {
          continue;
        }
        for (const childId of node.children) {
          if (!reachable.has(childId)) {
            reachable.add(childId);
            queue.push(childId);
          }
        }
      }
      for (const id of Object.keys(state.nodes)) {
        if (!reachable.has(id)) {
          delete state.nodes[id];
        }
      }
    },

    /**
     * Rebuilds the root list from the shared-documents list.
     * A document appears in the Shared section only when it is BOTH truly
     * root-level (real `parentId` is null) AND has active collaborators —
     * except shared-with-me documents, which have no position in the user's
     * own tree and therefore float at the root of the Shared section when
     * their real parent is not also shared with the user.
     * Nested documents owned by the user (real `parentId` set) are NOT
     * synthesized here: they stay in the Private tree under their actual
     * parent. This guarantees that reordering inside the Shared section can
     * never detach a nested document from its real parent.
     */
    syncSharedRoots(state, action: PayloadAction<SharedDocumentEntry[]>) {
      const entries = action.payload;
      const entryIds = new Set(entries.map((entry) => entry.id));
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));

      const rootEntryIds = new Set<string>();
      const entryNodes: Record<string, SidebarTreeNode> = {};

      for (const entry of entries) {
        if (entry.relationship === 'owner' && entry.parentId != null) {
          continue;
        }

        const parentEntry = entry.parentId ? entryById.get(entry.parentId) : undefined;
        const parentIsPrivateNested =
          !!parentEntry && parentEntry.relationship === 'owner' && parentEntry.parentId != null;
        const isChild =
          entry.relationship === 'collaborator' &&
          entry.parentId != null &&
          entryIds.has(entry.parentId) &&
          !parentIsPrivateNested;

        entryNodes[entry.id] = {
          id: entry.id,
          title: normalizeDocumentTitle(entry.meta.title),
          parentId: isChild ? entry.parentId : null,
          orderKey: entry.orderKey ?? `shared:${entry.id}`,
          hasChildren: false,
          effectiveAccessLevel:
            entry.relationship === 'owner' ? 'OWNER' : (entry.accessLevel ?? null),
          isExpanded: false,
          isLoading: false,
          children: [],
          childrenLoaded: false,
          createdAt: entry.meta.createdAt,
          updatedAt: entry.meta.updatedAt,
        };

        if (!isChild) {
          rootEntryIds.add(entry.id);
        }
      }

      // Preserve fetched children / expansion state for entries that keep a
      // place in the Shared tree, then merge the fresh entries.
      const keepIds = new Set<string>([...rootEntryIds]);
      for (const id of Object.keys(entryNodes)) {
        keepIds.add(id);
      }
      for (const id of Object.keys(state.nodes)) {
        if (!keepIds.has(id) || !entryNodes[id]) {
          continue;
        }
        const existing = state.nodes[id];
        const preservedOrderKey =
          entryNodes[id].orderKey && !entryNodes[id].orderKey.startsWith('shared:')
            ? entryNodes[id].orderKey
            : existing.orderKey && !existing.orderKey.startsWith('shared:')
              ? existing.orderKey
              : entryNodes[id].orderKey;
        entryNodes[id] = {
          ...entryNodes[id],
          orderKey: preservedOrderKey,
          effectiveAccessLevel:
            entryNodes[id].effectiveAccessLevel ?? existing.effectiveAccessLevel,
          hasChildren: existing.hasChildren,
          isExpanded: existing.isExpanded,
          isLoading: existing.isLoading,
          children: existing.children,
          childrenLoaded: existing.childrenLoaded,
        };
      }

      // Link nested shared-with-me entries under their shared parent so the
      // tree reflects the documents' real parent-child relationships.
      // Two-pass: all nodes are created before linking so child-before-parent
      // ordering (pagination) does not matter.
      for (const entry of entries) {
        if (entry.relationship !== 'collaborator' || entry.parentId == null) {
          continue;
        }
        if (!entryIds.has(entry.parentId)) {
          continue;
        }
        const parentEntry = entryById.get(entry.parentId);
        if (parentEntry?.relationship === 'owner' && parentEntry.parentId != null) {
          continue;
        }
        const parentNode = entryNodes[entry.parentId];
        if (!parentNode) {
          continue;
        }
        parentNode.hasChildren = true;
        if (!parentNode.children.includes(entry.id)) {
          parentNode.children.push(entry.id);
        }
      }

      Object.assign(state.nodes, entryNodes);

      // Prune nodes that are no longer reachable from the roots (unshared
      // documents, nested owned documents, removed parents, ...).
      const reachable = new Set<string>(rootEntryIds);
      const queue = [...rootEntryIds];
      while (queue.length > 0) {
        const id = queue.shift()!;
        const node = state.nodes[id];
        if (!node) {
          continue;
        }
        for (const childId of node.children) {
          if (!reachable.has(childId)) {
            reachable.add(childId);
            queue.push(childId);
          }
        }
      }
      for (const id of Object.keys(state.nodes)) {
        if (!reachable.has(id)) {
          delete state.nodes[id];
        }
      }

      // Roots: always order root documents by the caller's personal navigation order key.
      const newRootIds = entries
        .filter((entry) => rootEntryIds.has(entry.id))
        .map((entry) => entry.id);

      newRootIds.sort((aId, bId) => {
        const keyA = entryNodes[aId]?.orderKey ?? '';
        const keyB = entryNodes[bId]?.orderKey ?? '';
        if (!keyA.startsWith('shared:') && !keyB.startsWith('shared:')) {
          return compareOrderKeys(keyA, keyB);
        }
        return 0;
      });
      state.rootIds = newRootIds;
    },
  },
  extraReducers: (builder) => {
    // fetchChildrenThunk
    builder
      .addCase(fetchChildrenThunk.pending, (state, action) => {
        const parentId = action.meta.arg.parentId;
        if (state.nodes[parentId]) {
          state.nodes[parentId].isLoading = true;
        }
      })
      .addCase(fetchChildrenThunk.fulfilled, (state, action) => {
        applyFetchedChildren(state, action.payload);
      })
      .addCase(fetchChildrenThunk.rejected, (state, action) => {
        const parentId = action.meta.arg.parentId;
        if (state.nodes[parentId]) {
          state.nodes[parentId].isLoading = false;
        }
      });

    // fetchPublicChildrenThunk (guest share-link navigation, no auth)
    builder
      .addCase(fetchPublicChildrenThunk.pending, (state, action) => {
        const parentId = action.meta.arg.parentId;
        if (state.nodes[parentId]) {
          state.nodes[parentId].isLoading = true;
        }
      })
      .addCase(fetchPublicChildrenThunk.fulfilled, (state, action) => {
        applyFetchedChildren(state, action.payload);
      })
      .addCase(fetchPublicChildrenThunk.rejected, (state, action) => {
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

      // Update node record.
      // If a moved document has a parentId that is not in state.nodes, its parent is private to
      // the owner and not shared with this user. It therefore acts as a floated root in the
      // caller's Shared tree (effectiveParentId = null).
      // Note: Storing effectiveParentId into state.nodes[id].parentId is intentional for SidebarTreeNode
      // UI state so that tree rendering, reachability, and root drag-and-drop constraints function
      // correctly without referencing missing private parent nodes.
      const isFloatedRoot = Boolean(updatedNode.parentId && !state.nodes[updatedNode.parentId]);
      const effectiveParentId = isFloatedRoot ? null : updatedNode.parentId;

      state.nodes[updatedNode.id] = toSidebarTreeNode(
        {
          ...updatedNode,
          parentId: effectiveParentId,
        },
        existing ? existing.isExpanded : false
      );
      if (existing) {
        state.nodes[updatedNode.id].children = existing.children;
        state.nodes[updatedNode.id].childrenLoaded = existing.childrenLoaded;
      }

      if (effectiveParentId && state.nodes[effectiveParentId]) {
        const newParent = state.nodes[effectiveParentId];
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
      } else {
        // Root-level move or floated nested document (whose parent is external):
        // place the node at the root of the Shared tree and sort by personal orderKey.
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

export const {
  toggleExpanded,
  syncSharedRoots,
  syncPublicRoots,
  removeNode,
  resetTree,
  updateNodeMeta,
} = sharedTreeSlice.actions;

export default sharedTreeSlice.reducer;
