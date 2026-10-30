'use client';

import { useMemo } from 'react';
import { addToast } from '@/stores/toasts/toasts.slice';
import {
  fetchSpaceChildrenThunk,
  moveSpaceDocumentThunk,
  toggleNodeExpanded,
} from '@/stores/spaceTree/spaceTree.slice';
import { useAppDispatch } from '@/stores/hooks';
import type { SpaceTree as SpaceTreeState } from '@/stores/spaceTree/spaceTree.slice';
import type { SidebarTreeNode } from '@/types/tree.types';
import { SidebarTreeDndContext, type TreeApi } from './SidebarTreeDndContext';
import { SidebarTreeItem } from './SidebarTreeItem';
import type { DocActionsAnchor, DocActionType } from './types';

/**
 * Which drops one space accepts. A space root document anchors the space: the move
 * API clears a document's space when it is reparented, so nesting a root would
 * silently take it out of this group. Roots therefore only reorder; documents
 * already nested may be moved freely within the space.
 */
export function canDropWithinSpace(
  nodes: Record<string, SidebarTreeNode>,
  draggedId: string,
  target: { nodeId: string; zone: string }
): boolean {
  const dragged = nodes[draggedId];
  const targetNode = nodes[target.nodeId];
  if (!dragged || !targetNode) {
    return false;
  }

  if (dragged.parentId != null) {
    return true;
  }

  return targetNode.parentId == null && (target.zone === 'top' || target.zone === 'bottom');
}

export type SpaceTreeProps = {
  spaceId: string;
  tree: SpaceTreeState;
  activeDocId: string;
  onSelectDocument: (documentId: string) => void;
  onCreateChild: (parentId: string) => void;
  docActionsAnchor: DocActionsAnchor | null;
  onToggleDocumentActions: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
  isActionsEnabled: boolean;
};

/**
 * One space's documents, rendered with the same row component as the Private and
 * Shared trees: expand/collapse, nested documents, hover (+)/(…), drop lines, and
 * drag-to-reorder all come from the shared tree primitives.
 */
export function SpaceTree({
  spaceId,
  tree,
  activeDocId,
  onSelectDocument,
  onCreateChild,
  docActionsAnchor,
  onToggleDocumentActions,
  isActionsEnabled,
}: SpaceTreeProps) {
  const dispatch = useAppDispatch();
  const { nodes } = tree;

  const treeApi = useMemo<TreeApi>(
    () => ({
      nodes,
      rootIds: tree.rootIds,
      toggleExpanded: (nodeId) => dispatch(toggleNodeExpanded({ spaceId, nodeId })),
      fetchChildren: (parentId) => void dispatch(fetchSpaceChildrenThunk({ spaceId, parentId })),
      moveDocument: (args) => {
        void dispatch(moveSpaceDocumentThunk({ spaceId, ...args }))
          .unwrap()
          .catch((error) => {
            console.error('Failed to move space document:', error);
            dispatch(
              addToast({ message: 'Failed to move document. Please try again.', type: 'error' })
            );
          });
      },
      canPlaceAtRoot: (draggedId) => nodes[draggedId]?.parentId == null,
      resolveDrop: (draggedId, target) => canDropWithinSpace(nodes, draggedId, target),
    }),
    [dispatch, nodes, spaceId, tree.rootIds]
  );

  return (
    <SidebarTreeDndContext treeApi={treeApi}>
      <ul className="flex flex-col gap-px">
        {tree.rootIds.map((nodeId) => (
          <SidebarTreeItem
            key={nodeId}
            nodeId={nodeId}
            depth={0}
            activeDocId={activeDocId}
            onSelectDocument={onSelectDocument}
            onCreateChild={onCreateChild}
            isActionsEnabled={isActionsEnabled}
            canCreateChildren={isActionsEnabled}
            docActionsAnchor={docActionsAnchor}
            onToggleDocumentActions={onToggleDocumentActions}
          />
        ))}
      </ul>
    </SidebarTreeDndContext>
  );
}
