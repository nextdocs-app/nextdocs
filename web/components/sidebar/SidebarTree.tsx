'use client';

import { useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  fetchRootNodesThunk,
  fetchChildrenThunk,
  toggleExpanded,
  moveDocumentThunk,
  updateNodeMeta,
} from '@/stores/sidebarTree/sidebarTree.slice';
import {
  selectRootLevelOwnerSharedDocumentIds,
  selectSharedWithMeDocumentIds,
} from '@/stores/documentList/documentList.selectors';
import { useAuth } from '@/hooks/useAuth.hook';
import { Plus } from '@/icons';
import { SidebarSection } from './SidebarSection';
import { SidebarTreeItem } from './SidebarTreeItem';
import { SidebarTreeDndContext, useTreeDndOptional, type TreeApi } from './SidebarTreeDndContext';
import type { DocActionsAnchor, DocActionType } from './types';
import { SIDEBAR_VISIBLE_COUNT } from './types';

export interface SidebarTreeProps {
  isOpen: boolean;
  onToggle: () => void;
  activeDocId: string;
  onSelectDocument: (id: string) => void;
  onCreateChild: (parentId?: string) => void;
  isActionsEnabled: boolean;
  docActionsAnchor: DocActionsAnchor | null;
  onToggleDocumentActions: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
  /** Called when the "Show More" row is clicked (opens the all-documents panel). */
  onShowAll: () => void;
  excludedNodeIds?: Set<string>;
  className?: string;
}

export function SidebarTree({
  isOpen,
  onToggle,
  activeDocId,
  onSelectDocument,
  onCreateChild,
  isActionsEnabled,
  docActionsAnchor,
  onToggleDocumentActions,
  onShowAll,
  excludedNodeIds: propExcludedNodeIds,
  className,
}: SidebarTreeProps) {
  const dispatch = useAppDispatch();
  const { isAuthenticated, accessToken } = useAuth();
  // When a parent provider exists (unified Private+Shared DnD), reuse it instead of
  // mounting a nested DndContext - dnd-kit drags cannot cross context boundaries.
  const hasOuterDndContext = useTreeDndOptional() !== null;
  const nodes = useAppSelector((state) => state.sidebarTree?.nodes ?? {});
  const rootIds = useAppSelector((state) => state.sidebarTree?.rootIds ?? []);
  const isRootLoading = useAppSelector((state) => state.sidebarTree?.isRootLoading ?? false);
  const sharedWithMeDocumentIds = useAppSelector(selectSharedWithMeDocumentIds);
  const rootLevelOwnerSharedDocumentIds = useAppSelector(selectRootLevelOwnerSharedDocumentIds);

  // Documents that live in the Shared section must not render in the Private
  // tree: everything shared with the user, plus root-level documents the user
  // shared with others. Nested documents that were shared (real parentId set)
  // stay in the Private tree under their actual parent.
  const fallbackExcludedNodeIds = useMemo(() => {
    const excluded = new Set<string>(sharedWithMeDocumentIds);
    for (const id of rootLevelOwnerSharedDocumentIds) {
      excluded.add(id);
    }
    return excluded;
  }, [sharedWithMeDocumentIds, rootLevelOwnerSharedDocumentIds]);

  const excludedNodeIds = propExcludedNodeIds ?? fallbackExcludedNodeIds;

  const visibleRootIds = useMemo(
    () => rootIds.filter((rootId) => !excludedNodeIds.has(rootId)),
    [rootIds, excludedNodeIds]
  );

  // The section only renders the first SIDEBAR_VISIBLE_COUNT roots; the rest
  // are reachable through the "Show More" row which opens the full panel.
  const renderedRootIds = visibleRootIds.slice(0, SIDEBAR_VISIBLE_COUNT);

  // Show More is derived after filtering excluded nodes; backend hasMore is not used for the
  // collapsed button (which is purely about truncated visible count). For the panel's infinite
  // scroll, hasMore is considered separately in Sidebar.tsx.
  const hasMore = visibleRootIds.length > SIDEBAR_VISIBLE_COUNT;

  useEffect(() => {
    void dispatch(fetchRootNodesThunk());
  }, [dispatch, isAuthenticated, accessToken]);

  useEffect(() => {
    const handleMetaUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string; meta: { title?: string } }>;
      if (customEvent.detail?.id) {
        dispatch(
          updateNodeMeta({
            id: customEvent.detail.id,
            title: customEvent.detail.meta?.title,
          })
        );
      }
    };

    const handleDocsChanged = () => {
      void dispatch(fetchRootNodesThunk());
    };

    window.addEventListener('document-meta-updated', handleMetaUpdate);
    window.addEventListener('cloud-documents-changed', handleDocsChanged);
    window.addEventListener('local-documents-changed', handleDocsChanged);

    return () => {
      window.removeEventListener('document-meta-updated', handleMetaUpdate);
      window.removeEventListener('cloud-documents-changed', handleDocsChanged);
      window.removeEventListener('local-documents-changed', handleDocsChanged);
    };
  }, [dispatch]);

  const treeApi = useMemo<TreeApi>(
    () => ({
      nodes,
      rootIds: visibleRootIds,
      toggleExpanded: (id) => dispatch(toggleExpanded(id)),
      fetchChildren: (parentId) => void dispatch(fetchChildrenThunk({ parentId })),
      moveDocument: (args) => void dispatch(moveDocumentThunk(args)),
      canPlaceAtRoot: () => true,
    }),
    [nodes, visibleRootIds, dispatch]
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
          excludedNodeIds={excludedNodeIds}
        />
      ))}
    </ul>
  );

  return (
    <SidebarSection
      className={className}
      title="Private"
      isOpen={isOpen}
      onToggle={onToggle}
      rightAction={
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateChild(undefined);
          }}
          title="New Document"
          aria-label="New Document"
          className="p-1 -my-1 rounded-sm opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 hover:bg-sidebar-foreground/15 text-muted-foreground transition-all duration-100 cursor-pointer"
        >
          <Plus size={16} />
        </button>
      }
      isLoading={isRootLoading}
      rootCount={visibleRootIds.length}
      hasMore={hasMore}
      emptyText="No documents yet"
      skeletonKeyPrefix="tree-root-skeleton"
      showAllAriaLabel="Show all documents"
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
