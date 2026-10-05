'use client';

import { useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { useAuth } from '@/hooks/useAuth.hook';
import { useSharedTreeRootSync } from '@/hooks/useSharedTreeRootSync.hook';
import {
  fetchChildrenThunk,
  fetchPublicChildrenThunk,
  toggleExpanded,
  moveDocumentThunk,
  updateNodeMeta,
} from '@/stores/sharedTree/sharedTree.slice';
import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';
import { SidebarSection } from './SidebarSection';
import { SidebarTreeItem } from './SidebarTreeItem';
import { SidebarTreeDndContext, useTreeDndOptional, type TreeApi } from './SidebarTreeDndContext';
import { subscribeDocumentMetaUpdated } from '@/lib/document-meta-event.util';
import type { DocActionsAnchor, DocActionType } from './types';
import { SIDEBAR_VISIBLE_COUNT } from './types';

export interface SharedTreeProps {
  isOpen: boolean;
  onToggle: () => void;
  documents: SharedDocumentEntry[];
  isLoading: boolean;
  activeDocId: string;
  onSelectDocument: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  isActionsEnabled: boolean;
  docActionsAnchor: DocActionsAnchor | null;
  onToggleDocumentActions: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
  resolveActionType: (documentId: string) => DocActionType;
  onShowAll: () => void;
  className?: string;
}

export function SharedTree({
  isOpen,
  onToggle,
  documents,
  isLoading,
  activeDocId,
  onSelectDocument,
  onCreateChild,
  isActionsEnabled,
  docActionsAnchor,
  onToggleDocumentActions,
  resolveActionType,
  onShowAll,
  className,
}: SharedTreeProps) {
  const dispatch = useAppDispatch();
  const { isAuthenticated } = useAuth();
  // Reuse the unified Private+Shared DnD provider when one is mounted above us.
  const hasOuterDndContext = useTreeDndOptional() !== null;
  const nodes = useAppSelector((state) => state.sharedTree?.nodes ?? {});
  const rootIds = useAppSelector((state) => state.sharedTree?.rootIds ?? []);

  // The section only renders the first SIDEBAR_VISIBLE_COUNT roots; the rest
  // are reachable through the "Show More" row which opens the full panel.
  const renderedRootIds = rootIds.slice(0, SIDEBAR_VISIBLE_COUNT);

  // Keep the shared tree roots in sync with the shared-documents list.
  // Guests have no document list; their roots are synced by useGuestSharedTree.
  useSharedTreeRootSync(documents);

  // Apply live title edits (own + collaborator via Yjs) instantly, including
  // nested children that syncSharedRoots never touches (they are loaded via
  // fetchChildrenThunk, not from the shared-documents list). Mirrors
  // SidebarTree's document-meta-updated handler for the private tree.
  useEffect(() => {
    return subscribeDocumentMetaUpdated((detail) => {
      dispatch(
        updateNodeMeta({
          id: detail.id,
          title: detail.meta?.title,
        })
      );
    });
  }, [dispatch]);

  const treeApi = useMemo<TreeApi>(
    () => ({
      nodes,
      rootIds,
      toggleExpanded: (id) => dispatch(toggleExpanded(id)),
      // Guests navigate public children (no token); signed-in users use the
      // authenticated children endpoint.
      fetchChildren: (parentId) =>
        void dispatch(
          isAuthenticated
            ? fetchChildrenThunk({ parentId })
            : fetchPublicChildrenThunk({ parentId })
        ),
      moveDocument: (args) => {
        if (!isAuthenticated) return;
        void dispatch(moveDocumentThunk(args));
      },
      // A document can only live at the root level of the shared section if it
      // is already a root; children are shared only through their root parent,
      // so they must never be moved out of the shared tree's root level.
      canPlaceAtRoot: (draggedId) => nodes[draggedId]?.parentId == null,
    }),
    [nodes, rootIds, dispatch, isAuthenticated]
  );

  const treeContent = (
    <ul className="flex flex-col gap-px">
      {renderedRootIds.map((rootId) => (
        <SidebarTreeItem
          key={rootId}
          nodeId={rootId}
          depth={0}
          activeDocId={activeDocId}
          onSelectDocument={onSelectDocument}
          onCreateChild={onCreateChild}
          isActionsEnabled={isActionsEnabled}
          docActionsAnchor={docActionsAnchor}
          onToggleDocumentActions={onToggleDocumentActions}
          resolveActionType={resolveActionType}
          reorderEnabled={isAuthenticated}
          // Guests cannot create documents inside someone else's tree (the API
          // needs an account), and cannot move or reorder anything in it: both
          // handlers are authenticated calls, so the affordances stay hidden.
          canCreateChildren={isAuthenticated}
          dndDisabled={!isAuthenticated}
        />
      ))}
    </ul>
  );

  return (
    <SidebarSection
      className={className}
      title="Shared"
      isOpen={isOpen}
      onToggle={onToggle}
      isLoading={isLoading}
      rootCount={rootIds.length}
      emptyText="No shared documents"
      skeletonKeyPrefix="shared-root-skeleton"
      showAllAriaLabel="Show all shared documents"
      onShowAll={onShowAll}
    >
      {hasOuterDndContext ? (
        treeContent
      ) : (
        <SidebarTreeDndContext treeApi={treeApi}>{treeContent}</SidebarTreeDndContext>
      )}
    </SidebarSection>
  );
}
