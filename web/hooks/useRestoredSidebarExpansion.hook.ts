'use client';

import { useEffect } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch } from '@/stores/hooks';
import { setSpaceExpanded } from '@/stores/sidebar/sidebar.slice';
import {
  fetchChildrenThunk as fetchPrivateChildren,
  setNodeExpanded as setPrivateNodeExpanded,
} from '@/stores/sidebarTree/sidebarTree.slice';
import {
  fetchChildrenThunk as fetchSharedChildren,
  fetchPublicChildrenThunk,
  setNodeExpanded as setSharedNodeExpanded,
} from '@/stores/sharedTree/sharedTree.slice';
import {
  fetchSpaceChildrenThunk,
  fetchSpaceRootsThunk,
  setNodeExpanded as setSpaceNodeExpanded,
} from '@/stores/spaceTree/spaceTree.slice';
import { sidebarTreePreference } from '@/lib/sidebar-preferences.util';
import type { RootState } from '@/stores/store';
import type { SidebarTreeNode } from '@/types/tree.types';

/**
 * Re-opens the branches the reader had unfolded before the reload.
 *
 * Expansion cannot be applied at boot: a nested page does not exist until its
 * parent's children have been fetched. So the remembered ids are held as
 * pending, and each store change re-checks them. A page that appears and is not
 * expanded is expanded and its children fetched, which makes its own children
 * appear on the next pass — the cascade costs one request per level the reader
 * actually had open, and nothing for the branches they had collapsed.
 *
 * Each id is handled once per page load, so a branch the reader collapses
 * afterwards is never re-opened behind their back.
 */
export function useRestoredSidebarExpansion(userId: string | null | undefined) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();

  useEffect(() => {
    const { documents, spaces } = sidebarTreePreference(userId).read();
    const pendingDocuments = new Set(documents);
    const pendingSpaces = new Set(spaces);
    if (pendingDocuments.size === 0 && pendingSpaces.size === 0) {
      return;
    }

    let lastTrees: readonly unknown[] = [];
    let scheduled = false;
    let cancelled = false;
    let stopped = false;
    let unsubscribe: (() => void) | null = null;

    const stop = () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    };

    const restoreTree = (
      nodes: Record<string, SidebarTreeNode>,
      expand: (id: string) => void,
      fetchChildren: (id: string) => void
    ) => {
      for (const id of [...pendingDocuments]) {
        const node = nodes[id];
        if (!node) {
          continue;
        }
        pendingDocuments.delete(id);
        // A page that is expanded but currently has no children is still the
        // state the reader chose; only the fetch is pointless.
        expand(id);
        if (node.hasChildren && !node.childrenLoaded) {
          fetchChildren(id);
        }
      }
    };

    const restore = () => {
      scheduled = false;
      if (cancelled || stopped) {
        return;
      }
      if (pendingDocuments.size === 0 && pendingSpaces.size === 0) {
        stop();
        return;
      }

      const state = store.getState();
      const trees = [
        state.sidebarTree.nodes,
        state.sharedTree.nodes,
        state.spaceTree.trees,
        state.spaceTree.spaces,
      ] as const;
      if (
        lastTrees.length === trees.length &&
        trees.every((tree, index) => tree === lastTrees[index])
      ) {
        return;
      }
      lastTrees = trees;

      const isSignedIn = Boolean(state.auth.accessToken);
      // A space is only unfolded once its listing proves the caller can see it.
      if (isSignedIn) {
        for (const spaceId of [...pendingSpaces]) {
          if (!state.spaceTree.spaces?.[spaceId]) {
            continue;
          }
          pendingSpaces.delete(spaceId);
          dispatch(setSpaceExpanded({ spaceId, expanded: true }));
          void dispatch(fetchSpaceRootsThunk({ spaceId }));
        }
      }

      restoreTree(
        state.sidebarTree.nodes,
        (id) => dispatch(setPrivateNodeExpanded({ id, expanded: true })),
        (id) => void dispatch(fetchPrivateChildren({ parentId: id }))
      );
      restoreTree(
        state.sharedTree.nodes,
        (id) => dispatch(setSharedNodeExpanded({ id, expanded: true })),
        (id) => {
          void dispatch(
            isSignedIn
              ? fetchSharedChildren({ parentId: id })
              : fetchPublicChildrenThunk({ parentId: id })
          );
        }
      );
      for (const [spaceId, tree] of Object.entries(state.spaceTree.trees)) {
        restoreTree(
          tree.nodes,
          (id) => dispatch(setSpaceNodeExpanded({ spaceId, nodeId: id, expanded: true })),
          (id) => void dispatch(fetchSpaceChildrenThunk({ spaceId, parentId: id }))
        );
      }

      // Nothing left to wait for: stop paying for a store subscription (and a
      // microtask per action) for the rest of the page's life.
      if (pendingDocuments.size === 0 && pendingSpaces.size === 0) {
        stop();
      }
    };

    const schedule = () => {
      if (scheduled || stopped) {
        return;
      }
      scheduled = true;
      // Joins the burst a single children fetch produces into one pass instead
      // of re-entering the subscription for every dispatched action.
      queueMicrotask(restore);
    };

    unsubscribe = store.subscribe(schedule);
    schedule();

    return () => {
      cancelled = true;
      stop();
    };
  }, [dispatch, store, userId]);
}
