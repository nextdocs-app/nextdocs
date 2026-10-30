'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Layers, MoreHorizontal, Plus } from '@/icons';
import { PageIcon } from '@/components/page/PageIcon';
import { SectionHeading } from '@/components/SectionHeading';
import { SpaceSettingsModal } from '@/components/settings/workspace/SpaceSettingsModal';
import type { SpaceNotice } from '@/components/settings/workspace/space-access.util';
import { generateDocumentId } from '@/lib/document-id.util';
import { dispatchSpacesUpdated, SPACES_UPDATED_EVENT } from '@/lib/spaces-event.util';
import { discardPendingDocument } from '@/lib/pending-cloud-create.util';
import { documentService } from '@/services/document.service';
import { spaceApiService } from '@/services/space.service';
import { addToast } from '@/stores/toasts/toasts.slice';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import {
  fetchSpaceChildrenThunk,
  fetchSpaceRootsThunk,
  resetTree,
  setNodeExpanded,
  updateNodeMeta,
  type SpaceTree as SpaceTreeState,
} from '@/stores/spaceTree/spaceTree.slice';
import { useTreeMetaSync } from '@/hooks/useTreeMetaSync.hook';
import { workspaceIconTileStyle } from '@/components/workspace/WorkspaceIconTile';
import type { Space } from '@/types/space.types';
import { SpaceActionsMenu } from './SpaceActionsMenu';
import { SpaceTree } from './SpaceTree';
import type { DocActionsAnchor, DocActionType, SpaceActionsAnchor } from './types';

export type SpacesSectionProps = {
  accessToken: string | null;
  activeDocId: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelectDocument: (documentId: string) => void;
  /** Current user id, for the settings popup's "you" row. */
  selfId: string | null;
  theme: 'dark' | 'light';
  /** The rail element, measured so the actions menu straddles its edge. */
  sidebarRef: React.RefObject<HTMLElement | null>;
  docActionsAnchor: DocActionsAnchor | null;
  onToggleDocumentActions: (
    event: React.MouseEvent<HTMLButtonElement>,
    documentId: string,
    actionType: DocActionType
  ) => void;
  className?: string;
};

/** Filing documents and creating them needs EDIT in the space. */
function canEditSpace(space: Space): boolean {
  return space.myAccessLevel === 'EDIT' || space.myAccessLevel === 'OWNER';
}

const EMPTY_TREE: SpaceTreeState = { nodes: {}, rootIds: [], isRootLoading: false };

// The rail is a vertical list inside its own section: like a Notion block drag,
// the row moves only on the y axis and never past the first or last space.
const restrictSpaceDragToSection: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect,
}) => {
  if (!draggingNodeRect || !containerNodeRect) {
    return { ...transform, x: 0 };
  }

  const rangeTop = containerNodeRect.top - draggingNodeRect.top;
  const rangeBottom = containerNodeRect.top + containerNodeRect.height - draggingNodeRect.bottom;

  return {
    ...transform,
    x: 0,
    y: Math.min(Math.max(transform.y, rangeTop), rangeBottom),
  };
};

const SPACE_DRAG_MODIFIERS: Modifier[] = [restrictSpaceDragToSection];

type SortableSpaceHandle = Pick<
  ReturnType<typeof useSortable>,
  'attributes' | 'listeners' | 'setActivatorNodeRef'
>;

/**
 * One sortable space row. The header is the drag activator; the documents
 * inside the space keep their own drag context and never start a space drag.
 */
function SortableSpaceItem({
  spaceId,
  children,
}: {
  spaceId: string;
  children: (handle: SortableSpaceHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: spaceId });

  return (
    <li
      ref={setNodeRef}
      // The floating preview owns the drag; the slot stays as a gap so sibling
      // heights (and an expanded tree) never distort the row being dragged.
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        visibility: isDragging ? 'hidden' : undefined,
      }}
      className="relative flex flex-col"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

/** Compact row that follows the pointer while a space is dragged. */
function SpaceDragPreview({ space, accessToken }: { space: Space; accessToken: string | null }) {
  const tile = workspaceIconTileStyle(space.icon);

  return (
    <div className="flex w-full items-center gap-2 rounded-sm bg-sidebar-accent px-2.5 py-1.5 text-sidebar-foreground shadow-lg">
      <span
        style={tile.style}
        className={`flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px] ${tile.className}`}
      >
        {space.icon ? (
          <PageIcon
            icon={space.icon}
            size={space.icon.type === 'upload' || space.icon.type === 'link' ? 20 : 13}
            accessToken={accessToken ?? undefined}
          />
        ) : (
          <Layers size={13} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{space.name}</span>
      <ChevronRight size={14} className="flex-shrink-0 text-sidebar-foreground/50" />
    </div>
  );
}

/**
 * Spaces above the document sections.
 *
 * A space is a container, not a document, so its row differs from a document row on
 * purpose: its caret never leaves the right edge (documents reveal one over
 * their icon), its glyph falls back to the spaces mark, and a thin spine runs
 * from under that glyph through the documents it holds. Inside, documents use the same
 * rows as the Private and Shared trees.
 */
export function SpacesSection({
  accessToken,
  activeDocId,
  isOpen,
  onToggle,
  onSelectDocument,
  selfId,
  theme,
  sidebarRef,
  docActionsAnchor,
  onToggleDocumentActions,
  className,
}: SpacesSectionProps) {
  const dispatch = useAppDispatch();
  const spaceTrees = useAppSelector((state) => state.spaceTree.trees);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [menuAnchor, setMenuAnchor] = useState<SpaceActionsAnchor | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<{
    space: Space;
    tab: 'general' | 'members';
  } | null>(null);

  // Same activation rules as the document trees: a click still expands, and a
  // deliberate drag (5px, or a long press on touch) reorders the space instead.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } })
  );

  // The list is chrome in front of the document tree: a failed refresh keeps
  // the spaces that were already listed rather than blanking the rail.
  const loadSpaces = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    try {
      const items = await spaceApiService.list(accessToken);
      // Spaces in the sidebar are for browsing and editing documents. A workspace admin
      // can see all spaces of the workspace for administration (in Settings), but
      // spaces they are not part of (myAccessLevel === null) must not appear in the rail.
      setSpaces(items.filter((space) => space.myAccessLevel != null));
    } catch (error) {
      console.error('Failed to load spaces:', error);
    }
  }, [accessToken]);

  const handleSpaceDragStart = useCallback((event: DragStartEvent) => {
    setMenuAnchor(null);
    setActiveSpaceId(String(event.active.id));
  }, []);

  const handleSpaceDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSpaceId(null);
      const { active, over } = event;
      if (!over || !spaces || active.id === over.id) {
        return;
      }

      const fromIndex = spaces.findIndex((space) => space.id === active.id);
      const toIndex = spaces.findIndex((space) => space.id === over.id);
      if (fromIndex < 0 || toIndex < 0) {
        return;
      }

      // The API positions a space against its neighbours, never an index.
      const reordered = arrayMove(spaces, fromIndex, toIndex);
      const moved = reordered[toIndex];
      setSpaces(reordered);

      if (!accessToken) {
        return;
      }

      spaceApiService
        .move(accessToken, moved.id, {
          prevSiblingId: reordered[toIndex - 1]?.id ?? null,
          nextSiblingId: reordered[toIndex + 1]?.id ?? null,
        })
        .then((updated) => {
          setSpaces(
            (previous) =>
              previous?.map((space) => (space.id === updated.id ? updated : space)) ?? previous
          );
          // The first move gives every visible space a stored key; refetch so
          // the rail shows exactly the order the server persisted.
          dispatchSpacesUpdated();
        })
        .catch((error: unknown) => {
          console.error('Failed to move space:', error);
          setSpaces((previous) => (previous ? arrayMove(previous, toIndex, fromIndex) : previous));
          dispatch(addToast({ message: 'Failed to move space. Please try again.', type: 'error' }));
        });
    },
    [accessToken, dispatch, spaces]
  );

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  // Settings mutations (create, rename, archive, delete) leave this copy stale
  // while the dialog is open above the rail, and a document created outside the
  // rail changes a group's documents.
  useEffect(() => {
    const handleSpacesUpdated = () => {
      void loadSpaces();
    };
    const handleDocumentsChanged = () => {
      for (const spaceId of expandedSpaceIds) {
        void dispatch(fetchSpaceRootsThunk({ spaceId, background: true }));
      }
    };

    window.addEventListener(SPACES_UPDATED_EVENT, handleSpacesUpdated);
    window.addEventListener('cloud-documents-changed', handleDocumentsChanged);
    window.addEventListener('local-documents-changed', handleDocumentsChanged);

    return () => {
      window.removeEventListener(SPACES_UPDATED_EVENT, handleSpacesUpdated);
      window.removeEventListener('cloud-documents-changed', handleDocumentsChanged);
      window.removeEventListener('local-documents-changed', handleDocumentsChanged);
    };
  }, [dispatch, expandedSpaceIds, loadSpaces]);

  useTreeMetaSync(dispatch, updateNodeMeta);

  const setSpaceExpanded = useCallback((spaceId: string, isExpanded: boolean) => {
    setExpandedSpaceIds((previous) => {
      const next = new Set(previous);
      if (isExpanded) {
        next.add(spaceId);
      } else {
        next.delete(spaceId);
      }
      return next;
    });
  }, []);

  const toggleSpace = useCallback(
    (spaceId: string) => {
      setMenuAnchor(null);
      const isExpanding = !expandedSpaceIds.has(spaceId);
      setSpaceExpanded(spaceId, isExpanding);

      // Every expand refetches: documents can be added from the editor or another
      // surface while the group is collapsed, and a cache would show them stale.
      if (isExpanding) {
        void dispatch(fetchSpaceRootsThunk({ spaceId }));
      }
    },
    [dispatch, expandedSpaceIds, setSpaceExpanded]
  );

  const expandSpace = useCallback(
    (spaceId: string) => {
      setSpaceExpanded(spaceId, true);
      void dispatch(fetchSpaceRootsThunk({ spaceId }));
    },
    [dispatch, setSpaceExpanded]
  );

  /**
   * A root document is filed into the space on create; a nested document is created
   * under its parent instead, which inherits the parent's space. Both need the
   * cloud row (the space listing is server-side), so an offline attempt is
   * refused instead of queued into a document the space would never list.
   */
  const createDocument = useCallback(
    async (space: Space, parentId?: string) => {
      if (!accessToken) {
        return;
      }

      if (navigator.onLine === false) {
        dispatch(
          addToast({
            message: 'Connect to the internet to create a document in a space.',
            type: 'error',
          })
        );
        return;
      }

      const newId = generateDocumentId();
      try {
        const draft = await documentService.createDocument();
        await documentService.saveDocument(newId, draft.ydoc, draft.meta);

        const created = await documentService.createCloudDocument(
          accessToken,
          newId,
          draft.meta.title || 'Untitled',
          draft.ydoc,
          draft.meta.createdBy ?? null,
          parentId ?? null,
          null,
          null,
          parentId ? null : space.id
        );
        await documentService.saveDocument(created.id, created.ydoc, created.meta);

        if (parentId) {
          dispatch(setNodeExpanded({ spaceId: space.id, nodeId: parentId, expanded: true }));
          void dispatch(fetchSpaceChildrenThunk({ spaceId: space.id, parentId }));
        } else {
          // Expand (or refresh) the group so the new root document is listed.
          expandSpace(space.id);
        }

        onSelectDocument(created.id);
      } catch (error) {
        console.error('Failed to create space document:', error);
        // The server refused (or the space grant does not allow it): forget the
        // local copy so the rail cannot point at a document that does not exist.
        await discardPendingDocument(newId);
        dispatch(
          addToast({
            message: 'Failed to create document in this space. Please try again.',
            type: 'error',
          })
        );
      }
    },
    [accessToken, dispatch, expandSpace, onSelectDocument]
  );

  const openSpaceMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, spaceId: string) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();

      setMenuAnchor((previous) =>
        previous?.spaceId === spaceId
          ? null
          : {
              spaceId,
              // Plain numbers: a DOMRect's geometry lives on its prototype, so
              // spreading it would yield an empty object.
              trigger: {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
              // Measured instead of derived from the stored width: the
              // documents panel is wider than the rail.
              panelEdgeX: sidebarRef.current?.getBoundingClientRect().right ?? null,
            }
      );
    },
    [sidebarRef]
  );

  // One menu is open at a time; its trigger and popup both carry the root
  // attribute, so pressing either never counts as an outside press.
  useEffect(() => {
    if (!menuAnchor) {
      return;
    }

    const rootSelector = `[data-space-actions-root='${menuAnchor.spaceId}']`;
    const handleOutsidePress = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(rootSelector)) {
        setMenuAnchor(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuAnchor(null);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(rootSelector)) {
        return;
      }
      setMenuAnchor(null);
    };

    document.addEventListener('pointerdown', handleOutsidePress);
    document.addEventListener('mousedown', handleOutsidePress);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePress);
      document.removeEventListener('mousedown', handleOutsidePress);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [menuAnchor]);

  const handleSpaceChange = useCallback(
    (next: Space) => {
      setSpaces((previous) => {
        if (!previous) {
          return previous;
        }
        // Archived spaces leave the rail; the settings panel keeps their restore view.
        // Spaces where the caller is not a member also leave the rail.
        if (next.archivedAt || next.myAccessLevel == null) {
          return previous.filter((space) => space.id !== next.id);
        }
        return previous.map((space) => (space.id === next.id ? next : space));
      });
      setSettingsView((previous) =>
        previous?.space.id === next.id ? { ...previous, space: next } : previous
      );

      // An archived or unjoined space must not keep a tree (or an expansion) around.
      if (next.archivedAt || next.myAccessLevel == null) {
        setExpandedSpaceIds((previous) => {
          const remaining = new Set(previous);
          remaining.delete(next.id);
          return remaining;
        });
        dispatch(resetTree(next.id));
      }
    },
    [dispatch]
  );

  const handleSpaceRemoved = useCallback(
    (spaceId: string) => {
      setSpaces((previous) => previous?.filter((space) => space.id !== spaceId) ?? previous);
      setExpandedSpaceIds((previous) => {
        const next = new Set(previous);
        next.delete(spaceId);
        return next;
      });
      setSettingsView((previous) => (previous?.space.id === spaceId ? null : previous));
      dispatch(resetTree(spaceId));
    },
    [dispatch]
  );

  const handleSpaceNotice = useCallback(
    (notice: SpaceNotice | null) => {
      if (!notice) {
        return;
      }
      dispatch(
        addToast({
          message: notice.message,
          type: notice.kind === 'error' ? 'error' : 'success',
        })
      );
    },
    [dispatch]
  );

  // Nothing to show while the first fetch runs, and nothing at all for a
  // workspace without spaces: an empty "Spaces" header would be dead chrome.
  if (!spaces || spaces.length === 0) {
    return null;
  }

  const menuSpace = menuAnchor
    ? (spaces.find((space) => space.id === menuAnchor.spaceId) ?? null)
    : null;
  const activeSpace = activeSpaceId
    ? (spaces.find((space) => space.id === activeSpaceId) ?? null)
    : null;

  return (
    <div className={`group flex flex-col ${className ?? ''}`.trim()}>
      {/* Same shell as the document sections, minus a trailing action. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label="Spaces"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="group/header mx-1.5 flex items-center justify-between rounded-sm py-[5px] pl-2 pr-2 text-[13.5px] text-muted-foreground transition-colors duration-100 hover:bg-sidebar-accent cursor-pointer select-none"
      >
        <span className="flex min-w-0 items-center gap-1">
          <SectionHeading
            as="span"
            className="transition-colors duration-100 group-hover/header:text-muted-foreground"
          >
            Spaces
          </SectionHeading>
          <ChevronRight
            size={14}
            className={`flex-shrink-0 opacity-0 transition-all duration-150 group-hover:opacity-100 ${
              isOpen ? 'rotate-90' : 'rotate-0'
            }`}
          />
        </span>
      </div>

      {isOpen && (
        <nav className="px-1.5 pt-px pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={SPACE_DRAG_MODIFIERS}
            onDragStart={handleSpaceDragStart}
            onDragEnd={handleSpaceDragEnd}
            onDragCancel={() => setActiveSpaceId(null)}
          >
            <SortableContext
              items={spaces.map((space) => space.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-px">
                {spaces.map((space) => {
                  const isExpanded = expandedSpaceIds.has(space.id);
                  const tree = spaceTrees[space.id] ?? EMPTY_TREE;
                  const isEditable = canEditSpace(space);
                  const isMenuOpen = menuAnchor?.spaceId === space.id;
                  // A first expansion has no tree yet; the fetch it dispatches fills it.
                  const isLoading = !spaceTrees[space.id] || tree.isRootLoading;
                  const showSkeleton = isLoading && tree.rootIds.length === 0;
                  const tile = workspaceIconTileStyle(space.icon);

                  return (
                    <SortableSpaceItem key={space.id} spaceId={space.id}>
                      {(dragHandle) => (
                        <>
                          <div
                            ref={dragHandle.setActivatorNodeRef}
                            {...dragHandle.attributes}
                            {...dragHandle.listeners}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            aria-label={`${space.name} space`}
                            onClick={() => toggleSpace(space.id)}
                            onKeyDown={(event) => {
                              // The row is its own button, but the hover actions inside
                              // are buttons too: their Enter/Space must not toggle the space.
                              if (event.target !== event.currentTarget) {
                                return;
                              }
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggleSpace(space.id);
                              }
                            }}
                            className="group/space relative flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sidebar-foreground/90 transition-colors duration-100 hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer"
                          >
                            <span
                              style={tile.style}
                              className={`flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px] ${tile.className}`}
                              data-testid={space.icon ? undefined : 'space-placeholder'}
                            >
                              {space.icon ? (
                                <PageIcon
                                  icon={space.icon}
                                  size={
                                    space.icon.type === 'upload' || space.icon.type === 'link'
                                      ? 20
                                      : 13
                                  }
                                  accessToken={accessToken ?? undefined}
                                />
                              ) : (
                                <Layers size={13} />
                              )}
                            </span>

                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                              {space.name}
                            </span>

                            {/* Hover actions sit before the caret, which never moves. */}
                            <span
                              className={`flex items-center gap-0.5 transition-opacity pointer-coarse:opacity-100 ${
                                isMenuOpen
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover/space:opacity-100 focus-within:opacity-100'
                              }`}
                            >
                              {isEditable && (
                                <button
                                  type="button"
                                  title={`New document in ${space.name}`}
                                  aria-label={`New document in ${space.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setMenuAnchor(null);
                                    void createDocument(space);
                                  }}
                                  className="p-1 -m-0.5 rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-foreground/15 hover:text-sidebar-foreground cursor-pointer pointer-coarse:p-1.5 pointer-coarse:m-0"
                                >
                                  <Plus size={15} />
                                </button>
                              )}
                              <button
                                type="button"
                                data-space-actions-root={space.id}
                                aria-haspopup="menu"
                                aria-expanded={isMenuOpen}
                                aria-label={`${space.name} options`}
                                onClick={(event) => openSpaceMenu(event, space.id)}
                                className="p-1 -m-0.5 rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-foreground/15 hover:text-sidebar-foreground cursor-pointer pointer-coarse:p-1.5 pointer-coarse:m-0"
                              >
                                <MoreHorizontal size={17} />
                              </button>
                            </span>

                            {/* The caret is a permanent part of the row, not a hover swap. */}
                            <span
                              data-space-caret={space.id}
                              aria-hidden="true"
                              className="flex-shrink-0"
                            >
                              <ChevronRight
                                size={14}
                                className={`text-sidebar-foreground/50 transition-transform duration-150 ${
                                  isExpanded ? 'rotate-90' : 'rotate-0'
                                }`}
                              />
                            </span>
                          </div>

                          {isExpanded && (
                            <div className="relative flex flex-col">
                              {/* Spine from the space glyph down through its documents: the
                          visual mark that separates a container from a document. */}
                              <span
                                aria-hidden="true"
                                data-space-spine={space.id}
                                className="pointer-events-none absolute top-0 bottom-1 left-[20px] z-[1] w-px bg-sidebar-border"
                              />

                              <div className="pb-1 pl-6">
                                {showSkeleton ? (
                                  <ul className="flex flex-col gap-px">
                                    {[0, 1].map((index) => (
                                      <li
                                        key={`${space.id}-skeleton-${index}`}
                                        className="pl-2 py-1.5"
                                      >
                                        <span className="flex items-center gap-2">
                                          <span className="h-[17px] w-[17px] flex-shrink-0 animate-pulse rounded-sm bg-sidebar-foreground/10" />
                                          <span className="h-3 w-28 animate-pulse rounded-sm bg-sidebar-foreground/10" />
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : tree.rootIds.length > 0 ? (
                                  <SpaceTree
                                    spaceId={space.id}
                                    tree={tree}
                                    activeDocId={activeDocId}
                                    onSelectDocument={(documentId) => {
                                      setMenuAnchor(null);
                                      onSelectDocument(documentId);
                                    }}
                                    onCreateChild={(parentId) => {
                                      void createDocument(space, parentId);
                                    }}
                                    docActionsAnchor={docActionsAnchor}
                                    onToggleDocumentActions={onToggleDocumentActions}
                                    isActionsEnabled={Boolean(accessToken)}
                                  />
                                ) : (
                                  <p className="select-none pb-1 pl-2 text-[13px] italic text-muted-foreground/50">
                                    No documents yet
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </SortableSpaceItem>
                  );
                })}
              </ul>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeSpace ? (
                <SpaceDragPreview space={activeSpace} accessToken={accessToken} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </nav>
      )}

      {menuAnchor && menuSpace && (
        <SpaceActionsMenu
          anchor={menuAnchor}
          spaceName={menuSpace.name}
          theme={theme}
          canAdminister={menuSpace.canAdminister}
          onOpenMembers={() => {
            setMenuAnchor(null);
            setSettingsView({ space: menuSpace, tab: 'members' });
          }}
          onOpenSettings={() => {
            setMenuAnchor(null);
            setSettingsView({ space: menuSpace, tab: 'general' });
          }}
        />
      )}

      {settingsView && accessToken && (
        <SpaceSettingsModal
          key={settingsView.space.id}
          space={settingsView.space}
          initialTab={settingsView.tab}
          accessToken={accessToken}
          selfId={selfId}
          onClose={() => setSettingsView(null)}
          onSpaceChange={handleSpaceChange}
          onSpaceRemoved={handleSpaceRemoved}
          onNotice={handleSpaceNotice}
        />
      )}
    </div>
  );
}
