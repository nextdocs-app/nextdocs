import { useCallback, useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronRight, DocumentText, MoreHorizontal, Plus } from '@/icons';
import { useTreeDndOptional } from './SidebarTreeDndContext';
import type { TreeApi } from './SidebarTreeDndContext';
import type { DocActionsAnchor, DocActionType } from './types';

export interface SidebarTreeItemProps {
  nodeId: string;
  depth: number;
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
  resolveActionType?: (documentId: string) => DocActionType;
  /** Node ids (e.g. shared documents) that must not render inside this tree. */
  excludedNodeIds?: ReadonlySet<string>;
  /** Tree data when rendered outside a SidebarTreeDndContext (e.g. the panel). */
  treeApi?: TreeApi;
  /** Render without drag-and-drop affordances (used by the documents panel). */
  dndDisabled?: boolean;
  /** When searching, only these node ids are rendered (matching nodes + ancestors). */
  visibleIds?: ReadonlySet<string> | null;
  /** When searching, children are shown regardless of the collapsed state. */
  forceShowChildren?: boolean;
  /** Allow root-level reordering even when the node's access level would
   * otherwise gate editing; used by the shared tree where reordering the
   * user's own navigation is allowed for every collaborator. */
  reorderEnabled?: boolean;
}

function zoneId(nodeId: string, zone: string) {
  return `${nodeId}__${zone}`;
}

const EMPTY_DROP_STATE = {
  lineAt: null,
  highlightNodeId: null,
  lineInEmptyOf: null,
};

export function SidebarTreeItem({
  nodeId,
  depth,
  activeDocId,
  onSelectDocument,
  onCreateChild,
  isActionsEnabled,
  docActionsAnchor,
  onToggleDocumentActions,
  resolveActionType,
  excludedNodeIds,
  treeApi: treeApiProp,
  dndDisabled = false,
  visibleIds,
  forceShowChildren = false,
  reorderEnabled = false,
}: SidebarTreeItemProps) {
  const dndContext = useTreeDndOptional();
  const treeApi = treeApiProp ?? dndContext?.treeApi ?? null;
  const node = treeApi?.nodes[nodeId];
  const dropState = dndContext && !dndDisabled ? dndContext.dropState : EMPTY_DROP_STATE;
  const { lineAt, highlightNodeId, lineInEmptyOf } = dropState;
  const visibleChildren = useMemo(() => {
    let children = node?.children.filter((childId) => !excludedNodeIds?.has(childId)) ?? [];
    if (visibleIds) {
      children = children.filter((childId) => visibleIds.has(childId));
    }
    return children;
  }, [node, excludedNodeIds, visibleIds]);
  const canEdit = node?.effectiveAccessLevel === 'EDIT' || node?.effectiveAccessLevel === 'OWNER';

  const canReorder = canEdit || (reorderEnabled && node?.parentId == null);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: nodeId,
    disabled: dndDisabled || !canReorder,
  });

  const { setNodeRef: setTopZoneRef } = useDroppable({ id: zoneId(nodeId, 'top') });
  const { setNodeRef: setMidZoneRef } = useDroppable({ id: zoneId(nodeId, 'mid') });
  const { setNodeRef: setBottomZoneRef } = useDroppable({ id: zoneId(nodeId, 'bottom') });
  const { setNodeRef: setEmptyZoneRef } = useDroppable({ id: zoneId(nodeId, 'empty') });

  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!node) return;

      if (!node.isExpanded && !node.childrenLoaded && !node.isLoading) {
        treeApi?.fetchChildren(nodeId);
      }
      treeApi?.toggleExpanded(nodeId);
    },
    [node, nodeId, treeApi]
  );

  const handleCreateChild = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!node) return;
      if (!node.isExpanded && !node.childrenLoaded && !node.isLoading) {
        treeApi?.fetchChildren(nodeId);
      }
      onCreateChild(nodeId);
    },
    [node, nodeId, treeApi, onCreateChild]
  );

  if (!node || !treeApi) {
    return null;
  }

  const isActive = node.id === activeDocId;
  const indentPx = 8 + depth * 12;
  const isDropTarget = highlightNodeId === node.id;
  const showLineTop = lineAt?.nodeId === node.id && lineAt.position === 'top';
  const showLineBottom = lineAt?.nodeId === node.id && lineAt.position === 'bottom';
  const showEmptyLine = lineInEmptyOf === node.id;
  const actionType = resolveActionType ? resolveActionType(node.id) : 'move-to-trash';
  const showChildren = forceShowChildren || node.isExpanded;

  return (
    <li
      ref={setNodeRef}
      className="relative flex flex-col gap-px"
      style={{ opacity: isDragging ? 0.35 : 1 }}
      data-doc-actions-root={node.id}
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        className={`group/tree-item-row relative w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-sm text-left transition-colors duration-100 cursor-pointer ${
          isDropTarget
            ? 'nd-tree-drop-highlight'
            : isActive
              ? 'bg-sidebar-accent/70 text-sidebar-foreground font-medium hover:bg-sidebar-accent hover:text-sidebar-foreground'
              : 'text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        }`}
        style={{ paddingLeft: `${indentPx}px` }}
        onClick={() => onSelectDocument(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectDocument(node.id);
          }
        }}
      >
        {/* Icon - document icon by default, chevron on hover for expandable items */}
        <div className="relative h-4 w-4 flex-shrink-0">
          <DocumentText
            size={16}
            className="absolute inset-0 opacity-80 group-hover/tree-item-row:opacity-0 transition-opacity"
          />
          <button
            type="button"
            onClick={handleToggleExpand}
            className="absolute -inset-0.5 flex items-center justify-center rounded-sm text-sidebar-foreground/60 opacity-0 group-hover/tree-item-row:opacity-100 transition-opacity hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 cursor-pointer"
            aria-label={node.isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={16}
              className={`transition-transform duration-150 ${
                node.isExpanded ? 'rotate-90' : 'rotate-0'
              }`}
            />
          </button>
        </div>

        {/* Title */}
        <span className="text-[13px] truncate flex-1 min-w-0">{node.title || 'Untitled'}</span>

        {/* Action buttons on hover */}
        <div
          className={`flex items-center gap-0.5 transition-opacity flex-shrink-0 ${
            docActionsAnchor?.documentId === node.id
              ? 'opacity-100'
              : 'opacity-0 group-hover/tree-item-row:opacity-100'
          }`}
        >
          {canEdit && (
            <button
              type="button"
              onClick={handleCreateChild}
              title="Add a document inside"
              aria-label="Add a document inside"
              className="p-1 -m-0.5 rounded-sm hover:bg-sidebar-foreground/15 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors cursor-pointer"
            >
              <Plus size={14} />
            </button>
          )}

          {isActionsEnabled && (
            <button
              type="button"
              aria-label={`Document actions for ${node.title || 'Untitled'}`}
              onClick={(e) => onToggleDocumentActions(e, node.id, actionType)}
              className="p-1 -m-0.5 rounded-sm hover:bg-sidebar-foreground/15 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors cursor-pointer"
            >
              <MoreHorizontal size={16} />
            </button>
          )}
        </div>

        {/* Drop zones: top/bottom for reordering (line), middle for reparenting (highlight) */}
        {!dndDisabled && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div ref={setTopZoneRef} className="absolute left-0 right-0 top-0 h-[30%]" />
            <div ref={setMidZoneRef} className="absolute left-0 right-0 top-[30%] h-[40%]" />
            <div ref={setBottomZoneRef} className="absolute left-0 right-0 bottom-0 h-[30%]" />
          </div>
        )}

        {/* Reorder drop line at the top edge */}
        {!dndDisabled && showLineTop && (
          <div className="nd-tree-drop-line pointer-events-none absolute left-2 right-2 -top-px h-[3px] rounded-full z-20" />
        )}

        {/* Reorder drop line at the bottom edge */}
        {!dndDisabled && showLineBottom && (
          <div className="nd-tree-drop-line pointer-events-none absolute left-2 right-2 -bottom-px h-[3px] rounded-full z-20" />
        )}
      </div>

      {/* Recursive Child List */}
      {showChildren && (
        <ul className="flex flex-col gap-px">
          {node.isLoading ? (
            <div
              className="flex items-center gap-2 py-1"
              style={{ paddingLeft: `${indentPx + 20}px` }}
            >
              <div className="h-3.5 w-3.5 rounded bg-sidebar-foreground/10 animate-pulse" />
              <div className="h-3 w-28 rounded bg-sidebar-foreground/10 animate-pulse" />
            </div>
          ) : node.childrenLoaded && visibleChildren.length === 0 ? (
            !forceShowChildren && (
              <div
                ref={setEmptyZoneRef}
                className="relative min-h-[26px] py-1 text-[12px] text-muted-foreground/50 italic select-none"
                style={{ paddingLeft: `${indentPx + 24}px` }}
              >
                No documents inside
                {!dndDisabled && showEmptyLine && (
                  <div className="nd-tree-drop-line pointer-events-none absolute left-2 right-2 -bottom-px h-[3px] rounded-full z-20" />
                )}
              </div>
            )
          ) : (
            visibleChildren.map((childId) => (
              <SidebarTreeItem
                key={childId}
                nodeId={childId}
                depth={depth + 1}
                activeDocId={activeDocId}
                onSelectDocument={onSelectDocument}
                onCreateChild={onCreateChild}
                isActionsEnabled={isActionsEnabled}
                docActionsAnchor={docActionsAnchor}
                onToggleDocumentActions={onToggleDocumentActions}
                resolveActionType={resolveActionType}
                excludedNodeIds={excludedNodeIds}
                treeApi={treeApiProp}
                dndDisabled={dndDisabled}
                visibleIds={visibleIds}
                forceShowChildren={forceShowChildren}
                reorderEnabled={reorderEnabled}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}
