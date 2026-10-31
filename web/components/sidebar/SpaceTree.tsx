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

function targetParentHasCollaborators(
  nodes: Record<string, SidebarTreeNode>,
  parentId: string | null
): boolean {
  let currId: string | null = parentId;
  while (currId) {
    const node = nodes[currId];
    if (!node) break;
    if (node.hasCollaborators) return true;
    currId = node.parentId;
  }
  return false;
}

/**
 * Which drops one space accepts. Documents in a space can be reordered at root
 * (only existing root documents may live at root level) or moved inside another
 * document in the same space (both root and nested documents).
 */
export function canDropWithinSpace(
  nodes: Record<string, SidebarTreeNode>,
  draggedId: string,
  target: { nodeId: string; zone: string },
  canAdministerSpace = false
): boolean {
  const dragged = nodes[draggedId];
  const targetNode = nodes[target.nodeId];
  if (!dragged || !targetNode) {
    return false;
  }

  if (draggedId === target.nodeId) {
    return false;
  }

  // Dropping at top/bottom of a space root places the document at the root level.
  // Only existing root documents may live at the space root level.
  if (targetNode.parentId == null && (target.zone === 'top' || target.zone === 'bottom')) {
    return dragged.parentId == null;
  }

  // Sibling reorder within the same parent is always allowed for space members.
  const isSiblingReorder =
    (target.zone === 'top' || target.zone === 'bottom') &&
    (dragged.parentId ?? null) === (targetNode.parentId ?? null);
  if (isSiblingReorder) {
    return true;
  }

  // Reparenting to a new parent:
  // - zone 'mid': nesting under targetNode
  // - zone 'top'/'bottom': reparenting under targetNode's parent
  const targetParentId = target.zone === 'mid' ? targetNode.id : targetNode.parentId;

  // Check if target parent (or any of its loaded ancestors) has external collaborators
  const hasCollaboratorOverrides = targetParentHasCollaborators(nodes, targetParentId);

  // If the target location has collaborators, only a space administrator or the
  // owner of the dragged document may move it there.
  if (hasCollaboratorOverrides && !canAdministerSpace && dragged.effectiveAccessLevel !== 'OWNER') {
    return false;
  }

  return true;
}

export type SpaceTreeProps = {
  spaceId: string;
  tree: SpaceTreeState;
  activeDocId: string;
  canAdministerSpace?: boolean;
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
  canAdministerSpace = false,
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
          .then((result) => {
            if (result.updatedNode.parentId) {
              const targetParent = nodes[result.updatedNode.parentId];
              if (targetParent && !targetParent.childrenLoaded && !targetParent.isLoading) {
                void dispatch(
                  fetchSpaceChildrenThunk({
                    spaceId,
                    parentId: result.updatedNode.parentId,
                  })
                );
              }
            }
          })
          .catch((error) => {
            console.error('Failed to move space document:', error);
            dispatch(
              addToast({ message: 'Failed to move document. Please try again.', type: 'error' })
            );
          });
      },
      canPlaceAtRoot: (draggedId) => Boolean(nodes[draggedId] && nodes[draggedId].parentId == null),
      resolveDrop: (draggedId, target) =>
        canDropWithinSpace(nodes, draggedId, target, canAdministerSpace),
    }),
    [canAdministerSpace, dispatch, nodes, spaceId, tree.rootIds]
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
