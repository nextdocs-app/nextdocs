'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { DocumentText } from '@/icons';
import type { SidebarTreeNode } from '@/types/tree.types';

export type TreeDropPosition = 'top' | 'bottom';

export interface MoveDocumentArgs {
  documentId: string;
  newParentId: string | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
}

export interface TreeApi {
  nodes: Record<string, SidebarTreeNode>;
  rootIds: string[];
  toggleExpanded: (id: string) => void;
  fetchChildren: (parentId: string) => void;
  moveDocument: (args: MoveDocumentArgs) => void;
  /** Whether the given node may be dropped at the tree's root level. */
  canPlaceAtRoot: (draggedId: string) => boolean;
  /** Optional resolver for root-level sibling IDs for a given node (e.g. per-tree roots in unified contexts). */
  getRootIds?: (targetNodeId: string) => string[];
  /**
   * Optional cross-tree drop policy. When provided it has final say over whether a
   * drop onto the given row/zone is offered; when absent the legacy single-tree
   * behavior (root policy + cycle checks only) applies.
   */
  resolveDrop?: (draggedId: string, target: { nodeId: string; zone: string }) => boolean;
}

export interface TreeDropState {
  activeId: string | null;
  /** Where to show the reorder line: at the top or bottom edge of a row. */
  lineAt: { nodeId: string; position: TreeDropPosition } | null;
  /** Row to highlight (blue, low opacity) as the reparent target. */
  highlightNodeId: string | null;
  /** Expanded parent with no children whose empty area gets the line. */
  lineInEmptyOf: string | null;
}

interface TreeDndContextValue {
  treeApi: TreeApi;
  dropState: TreeDropState;
}

const TreeDndContext = createContext<TreeDndContextValue | null>(null);

export function useTreeDnd() {
  const value = useContext(TreeDndContext);
  if (!value) {
    throw new Error('useTreeDnd must be used within a SidebarTreeDndContext');
  }
  return value;
}

/** Like useTreeDnd, but returns null when no provider is mounted (e.g. the panel tree). */
export function useTreeDndOptional(): TreeDndContextValue | null {
  return useContext(TreeDndContext);
}

const ZONE_SUFFIXES = ['top', 'mid', 'bottom', 'empty'];

function parseZoneId(zoneId: string): { nodeId: string; zone: string } | null {
  for (const suffix of ZONE_SUFFIXES) {
    const marker = `__${suffix}`;
    if (zoneId.endsWith(marker)) {
      const nodeId = zoneId.slice(0, -marker.length);
      if (nodeId.length === 0) return null;
      return { nodeId, zone: suffix };
    }
  }
  return null;
}

export function SidebarTreeDndContext({
  treeApi,
  children,
}: {
  treeApi: TreeApi;
  children: React.ReactNode;
}) {
  const { nodes, rootIds } = treeApi;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [lineAt, setLineAt] = useState<TreeDropState['lineAt']>(null);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const [lineInEmptyOf, setLineInEmptyOf] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const isDescendant = useCallback(
    (nodeId: string, ancestorId: string) => {
      let cursor = nodes[nodeId]?.parentId ?? null;
      while (cursor) {
        if (cursor === ancestorId) {
          return true;
        }
        cursor = nodes[cursor]?.parentId ?? null;
      }
      return false;
    },
    [nodes]
  );

  const clearDropState = useCallback(() => {
    setLineAt(null);
    setHighlightNodeId(null);
    setLineInEmptyOf(null);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(String(event.active.id));
      clearDropState();
    },
    [clearDropState]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!activeId) {
        return;
      }

      const overId = event.over ? String(event.over.id) : null;

      let nextLineAt: TreeDropState['lineAt'] = null;
      let nextHighlightNodeId: string | null = null;
      let nextLineInEmptyOf: string | null = null;

      if (overId) {
        const parsed = parseZoneId(overId);
        if (parsed) {
          const { nodeId, zone } = parsed;
          const policyAllows =
            !treeApi.resolveDrop || treeApi.resolveDrop(activeId, { nodeId, zone });
          if (nodeId !== activeId && !isDescendant(nodeId, activeId) && policyAllows) {
            if (zone === 'mid' || zone === 'empty') {
              if (zone === 'empty') {
                nextLineInEmptyOf = nodeId;
              } else {
                nextHighlightNodeId = nodeId;
              }
            } else if (zone === 'top' || zone === 'bottom') {
              // Line drops place the node as a sibling; dropping into the root
              // level is only allowed when the tree's root policy permits it.
              const targetParentId = nodes[nodeId]?.parentId ?? null;
              if (targetParentId !== null || treeApi.canPlaceAtRoot(activeId)) {
                nextLineAt = { nodeId, position: zone };
              }
            }
          }
        }
      }

      // Only update when the drop state actually changed. dnd-kit auto-scrolls
      // the sidebar while dragging, so rows move under the pointer and the same
      // zone can be reported repeatedly; updating state on every move makes the
      // reorder line/highlight flash on and off.
      if (
        nextLineAt?.nodeId !== lineAt?.nodeId ||
        nextLineAt?.position !== lineAt?.position ||
        nextHighlightNodeId !== highlightNodeId ||
        nextLineInEmptyOf !== lineInEmptyOf
      ) {
        setLineAt(nextLineAt);
        setHighlightNodeId(nextHighlightNodeId);
        setLineInEmptyOf(nextLineInEmptyOf);
      }
    },
    [activeId, nodes, treeApi, isDescendant, lineAt, highlightNodeId, lineInEmptyOf]
  );

  const handleDragEnd = useCallback(() => {
    const draggedId = activeId;
    setActiveId(null);
    clearDropState();

    if (!draggedId) {
      return;
    }

    const draggedNode = nodes[draggedId];
    if (!draggedNode) {
      return;
    }

    let targetParentId: string | null = null;
    let prevSiblingId: string | null = null;
    let nextSiblingId: string | null = null;
    let guardNodeId: string | null = null;
    let guardZone: string = 'mid';

    if (lineAt) {
      const overNode = nodes[lineAt.nodeId];
      if (!overNode) {
        return;
      }
      targetParentId = overNode.parentId;
      guardNodeId = lineAt.nodeId;
      guardZone = lineAt.position;
      const targetRootIds = treeApi.getRootIds ? treeApi.getRootIds(lineAt.nodeId) : rootIds;
      const rawSiblings =
        targetParentId && nodes[targetParentId] ? nodes[targetParentId].children : targetRootIds;
      const siblings = rawSiblings.filter((id) => id !== draggedId);
      const overIndex = siblings.indexOf(lineAt.nodeId);
      if (overIndex !== -1) {
        if (lineAt.position === 'top') {
          prevSiblingId = overIndex > 0 ? siblings[overIndex - 1] : null;
          nextSiblingId = lineAt.nodeId;
        } else {
          prevSiblingId = lineAt.nodeId;
          nextSiblingId = overIndex < siblings.length - 1 ? siblings[overIndex + 1] : null;
        }
      }
    } else if (highlightNodeId) {
      targetParentId = highlightNodeId;
      guardNodeId = highlightNodeId;
      guardZone = 'mid';
      const parent = nodes[highlightNodeId];
      if (parent && parent.childrenLoaded && parent.children.length > 0) {
        const parentChildren = parent.children.filter((id) => id !== draggedId);
        if (parentChildren.length > 0) {
          prevSiblingId = parentChildren[parentChildren.length - 1];
        }
      }
    } else if (lineInEmptyOf) {
      targetParentId = lineInEmptyOf;
      guardNodeId = lineInEmptyOf;
      guardZone = 'empty';
    } else {
      return;
    }

    // Cross-tree drop policy has final say (mirrors the drag-over gate).
    if (treeApi.resolveDrop) {
      if (
        !guardNodeId ||
        !treeApi.resolveDrop(draggedId, { nodeId: guardNodeId, zone: guardZone })
      ) {
        return;
      }
    }

    if (targetParentId === draggedId) {
      return;
    }

    // Root-level drops must respect the tree's root policy
    if (targetParentId === null && !treeApi.canPlaceAtRoot(draggedId)) {
      return;
    }

    // Cycle check: cannot drop into one of the dragged node's own descendants
    let ancestorCursor = targetParentId;
    while (ancestorCursor) {
      if (ancestorCursor === draggedId) {
        return;
      }
      ancestorCursor = nodes[ancestorCursor]?.parentId ?? null;
    }

    // Skip if the drop would not change the current position
    const currentRootIds = treeApi.getRootIds ? treeApi.getRootIds(draggedId) : rootIds;
    const currentSiblings =
      draggedNode.parentId && nodes[draggedNode.parentId]
        ? nodes[draggedNode.parentId].children
        : currentRootIds;
    const currentIndex = currentSiblings.indexOf(draggedId);
    const currentPrev = currentIndex > 0 ? currentSiblings[currentIndex - 1] : null;
    const currentNext =
      currentIndex !== -1 && currentIndex < currentSiblings.length - 1
        ? currentSiblings[currentIndex + 1]
        : null;

    if (
      targetParentId === draggedNode.parentId &&
      prevSiblingId === currentPrev &&
      nextSiblingId === currentNext
    ) {
      return;
    }

    if (prevSiblingId === draggedId) {
      prevSiblingId = null;
    }
    if (nextSiblingId === draggedId) {
      nextSiblingId = null;
    }

    treeApi.moveDocument({
      documentId: draggedId,
      newParentId: targetParentId,
      prevSiblingId,
      nextSiblingId,
    });
  }, [activeId, nodes, rootIds, lineAt, highlightNodeId, lineInEmptyOf, treeApi, clearDropState]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    clearDropState();
  }, [clearDropState]);

  const activeNode = activeId ? nodes[activeId] : null;

  // Show a grabbing hand cursor over the whole app while a drag is in progress
  useEffect(() => {
    document.body.classList.toggle('nd-is-dragging', Boolean(activeId));
    return () => {
      document.body.classList.remove('nd-is-dragging');
    };
  }, [activeId]);

  const dropState = useMemo<TreeDropState>(
    () => ({ activeId, lineAt, highlightNodeId, lineInEmptyOf }),
    [activeId, lineAt, highlightNodeId, lineInEmptyOf]
  );

  const contextValue = useMemo<TreeDndContextValue>(
    () => ({ treeApi, dropState }),
    [treeApi, dropState]
  );

  return (
    <TreeDndContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}

        <DragOverlay dropAnimation={null}>
          {activeNode ? (
            <div className="flex items-center gap-1.5 select-none">
              <DocumentText size={16} className="opacity-80 flex-shrink-0" aria-hidden="true" />
              <span className="text-[13px] font-medium text-sidebar-foreground whitespace-nowrap">
                {activeNode.title || 'Untitled'}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TreeDndContext.Provider>
  );
}
