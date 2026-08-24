'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  syncSharedRoots,
  fetchChildrenThunk,
  toggleExpanded,
  moveDocumentThunk,
} from '@/stores/sharedTree/sharedTree.slice';
import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';
import { SidebarSection } from './SidebarSection';
import { SidebarTreeItem } from './SidebarTreeItem';
import { SidebarTreeDndContext, useTreeDndOptional, type TreeApi } from './SidebarTreeDndContext';
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
  // Reuse the unified Private+Shared DnD provider when one is mounted above us.
  const hasOuterDndContext = useTreeDndOptional() !== null;
  const nodes = useAppSelector((state) => state.sharedTree?.nodes ?? {});
  const rootIds = useAppSelector((state) => state.sharedTree?.rootIds ?? []);

  // The section only renders the first SIDEBAR_VISIBLE_COUNT roots; the rest
  // are reachable through the "Show More" row which opens the full panel.
  const renderedRootIds = rootIds.slice(0, SIDEBAR_VISIBLE_COUNT);

  // Keep the shared tree roots in sync with the shared-documents list.
  // Runs only when the list content (ids + updatedAt) actually changes.
  const lastSyncRef = useRef<string>('');
  useEffect(() => {
    const signature = documents.map((doc) => `${doc.id}:${doc.meta.updatedAt}`).join('|');
    if (signature === lastSyncRef.current) {
      return;
    }
    lastSyncRef.current = signature;
    dispatch(syncSharedRoots(documents));
  }, [documents, dispatch]);

  const treeApi = useMemo<TreeApi>(
    () => ({
      nodes,
      rootIds,
      toggleExpanded: (id) => dispatch(toggleExpanded(id)),
      fetchChildren: (parentId) => void dispatch(fetchChildrenThunk({ parentId })),
      moveDocument: (args) => void dispatch(moveDocumentThunk(args)),
      // A document can only live at the root level of the shared section if it
      // is already a root; children are shared only through their root parent,
      // so they must never be moved out of the shared tree's root level.
      canPlaceAtRoot: (draggedId) => nodes[draggedId]?.parentId == null,
    }),
    [nodes, rootIds, dispatch]
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
          reorderEnabled
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
