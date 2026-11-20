'use client';

import { useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch } from '@/stores/hooks';
import { clearExpandedSpaces, hydratePreferences } from '@/stores/sidebar/sidebar.slice';
import {
  applySidebarCollapsedAttribute,
  MAX_REMEMBERED_DOCUMENTS,
  MAX_REMEMBERED_SPACES,
  mergeExpandedIds,
  sidebarTreePreference,
  sidebarUiPreference,
  type SidebarSections,
  type SidebarTreePreferences,
  type SidebarUiPreferences,
} from '@/lib/sidebar-preferences.util';
import type { RootState } from '@/stores/store';
import type { SidebarTreeNode } from '@/types/tree.types';

/**
 * Collapse and section toggles are deliberate clicks, so they are written at
 * once. Page expansion arrives in bursts (a restored branch fetches its
 * children level by level), so it is coalesced.
 */
const TREE_PERSIST_DEBOUNCE_MS = 300;

function collectNodeIds(
  nodes: Record<string, SidebarTreeNode>,
  expanded: Set<string>,
  loaded: Set<string>
) {
  for (const node of Object.values(nodes)) {
    loaded.add(node.id);
    if (node.isExpanded) {
      expanded.add(node.id);
    }
  }
}

function toUiPreferences(state: RootState): SidebarUiPreferences {
  return {
    collapsed: state.sidebar.isCollapsed,
    sections: {
      spaces: state.sidebar.isSpacesOpen,
      private: state.sidebar.isPrivateOpen,
      shared: state.sidebar.isSharedOpen,
    },
  };
}

/** Cheap "did anything remembered change" key; cheaper than serializing. */
function uiKey(collapsed: boolean, sections: SidebarSections): string {
  return `${collapsed}|${sections.spaces}|${sections.private}|${sections.shared}`;
}

/**
 * Remembers the rail across reloads: adopts what the head script already
 * painted, then keeps storage in step with the store.
 *
 * One subscription serves both preferences. The UI blob is compared as a string
 * so an unrelated dispatch writes nothing, and the tree walk is skipped unless
 * one of the tree containers actually changed identity, which is the cheap
 * signal that some node's expansion may have moved.
 */
export function useSidebarPreferences(userId: string | null | undefined) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // An unfolded space belongs to the account that opened it. Drop the store's
    // copy on an identity change before this effect subscribes, so the next
    // account's first tree pass cannot merge it into that account's key.
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      dispatch(clearExpandedSpaces());
    }
    previousUserId.current = userId;

    const treePreference = sidebarTreePreference(userId);
    const storedUi = sidebarUiPreference.read();

    // The rail is already this collapsed state and this width on screen; the
    // React tree only has to agree with it.
    dispatch(hydratePreferences(storedUi));
    applySidebarCollapsedAttribute(storedUi.collapsed);

    let lastUi = sidebarUiPreference.serialize(storedUi);
    let lastUiKey = uiKey(storedUi.collapsed, storedUi.sections);
    let lastTrees: readonly unknown[] = [];
    let pendingTree: SidebarTreePreferences | null = null;
    let treeTimer: ReturnType<typeof setTimeout> | null = null;

    const flushTree = () => {
      if (treeTimer !== null) {
        clearTimeout(treeTimer);
        treeTimer = null;
      }
      const value = pendingTree;
      pendingTree = null;
      if (!value) {
        return;
      }
      // Compare against what storage holds now, not what this effect last saw:
      // another tab (or an account sync) may have settled it since the pass
      // that queued this value, in which case the write is redundant.
      if (treePreference.serialize(value) === treePreference.serialize()) {
        return;
      }
      treePreference.set(value);
    };

    const syncUi = (state: RootState) => {
      const { isCollapsed, isSpacesOpen, isPrivateOpen, isSharedOpen } = state.sidebar;
      // A dispatch usually has nothing to do with the rail; compare the four
      // flags before touching storage at all.
      const nextKey = uiKey(isCollapsed, {
        spaces: isSpacesOpen,
        private: isPrivateOpen,
        shared: isSharedOpen,
      });
      if (nextKey === lastUiKey) {
        return;
      }
      lastUiKey = nextKey;

      const next = toUiPreferences(state);
      lastUi = sidebarUiPreference.serialize(next);
      // Setting notifies our own listener below, which would see an unchanged
      // value and skip it; the attribute is applied here so a toggle repaints
      // the CSS signal on the same frame as the React state.
      sidebarUiPreference.set(next);
      applySidebarCollapsedAttribute(next.collapsed);
    };

    const syncTree = (state: RootState) => {
      const privateNodes = state.sidebarTree.nodes;
      const sharedNodes = state.sharedTree.nodes;
      const spaceTrees = state.spaceTree.trees;
      const expandedSpaceIds = state.sidebar.expandedSpaceIds;
      const trees = [privateNodes, sharedNodes, spaceTrees, expandedSpaceIds] as const;
      if (
        lastTrees.length === trees.length &&
        trees.every((tree, index) => tree === lastTrees[index])
      ) {
        return;
      }
      lastTrees = trees;

      const expanded = new Set<string>();
      const loaded = new Set<string>();
      collectNodeIds(privateNodes, expanded, loaded);
      collectNodeIds(sharedNodes, expanded, loaded);
      for (const tree of Object.values(spaceTrees)) {
        collectNodeIds(tree.nodes, expanded, loaded);
      }

      const previous = treePreference.read();
      const documents = mergeExpandedIds(
        previous.documents,
        expanded,
        loaded,
        MAX_REMEMBERED_DOCUMENTS
      );
      // Guests hold no space membership, so a signed-out session must not
      // rewrite (or inherit) an account's space list.
      const spaces = state.auth.accessToken
        ? mergeExpandedIds(
            previous.spaces,
            new Set(expandedSpaceIds),
            new Set(Object.keys(state.spaceTree.spaces ?? {})),
            MAX_REMEMBERED_SPACES
          )
        : previous.spaces;

      if (
        documents.join(',') === previous.documents.join(',') &&
        spaces.join(',') === previous.spaces.join(',')
      ) {
        // The value that is about to be written is already what storage holds,
        // so a write queued by an earlier pass is stale (it was computed before
        // a restore re-expanded the branch) and must not overwrite this one.
        pendingTree = null;
        if (treeTimer !== null) {
          clearTimeout(treeTimer);
          treeTimer = null;
        }
        return;
      }

      pendingTree = { documents, spaces };
      if (treeTimer === null) {
        treeTimer = setTimeout(flushTree, TREE_PERSIST_DEBOUNCE_MS);
      }
    };

    // Another tab (or this tab's own write) settled the UI preference.
    const unsubscribePreference = sidebarUiPreference.subscribe((value) => {
      const serialized = sidebarUiPreference.serialize(value);
      if (serialized === lastUi) {
        return;
      }
      lastUi = serialized;
      lastUiKey = uiKey(value.collapsed, value.sections);
      dispatch(hydratePreferences(value));
      applySidebarCollapsedAttribute(value.collapsed);
    });

    const unsubscribeStore = store.subscribe(() => {
      const state = store.getState();
      syncUi(state);
      syncTree(state);
    });

    // A reload fires `pagehide`, so a debounced expansion is never lost to it.
    const handlePageHide = () => flushTree();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushTree();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubscribeStore();
      unsubscribePreference();
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushTree();
    };
  }, [dispatch, store, userId]);
}
