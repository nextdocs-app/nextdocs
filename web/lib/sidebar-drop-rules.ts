/**
 * Drop rules for the sidebar's two document trees (Private / Shared).
 *
 * Kept pure and side-effect free so both the drag-over visual gating and the
 * drop handler enforce identical policy.
 *
 * TODO(full-access): collaborators currently cannot re-share documents they do not
 * own - there is no FULL_ACCESS access level yet (sharing administration is
 * owner-only). Until that exists:
 *   - moving a document between two shared documents is blocked in the UI;
 *   - only sibling reordering inside the Shared section is allowed.
 * Owners can still reorganize their own trees; the backend enforces the same
 * ownership model server-side.
 */

export type SidebarDropZone = 'top' | 'bottom' | 'mid' | 'empty';

export interface SidebarDropRuleContext {
  draggedId: string;
  /** The dragged document lives in the Shared section. */
  draggedIsShared: boolean;
  /** The drop target row lives in the Shared section. */
  targetIsShared: boolean;
  draggedParentId: string | null;
  targetParentId: string | null;
}

export type SidebarMoveRoute =
  | { kind: 'private' }
  | { kind: 'shared-reorder' }
  | { kind: 'shared-nest-adopt'; hostParentId: string }
  | { kind: 'blocked' };

/** Whether the drag-over state for this zone should be shown at all. */
export function isSidebarDropAllowed(zone: SidebarDropZone, ctx: SidebarDropRuleContext): boolean {
  const nestingDrop = zone === 'mid' || zone === 'empty';

  if (!ctx.draggedIsShared && ctx.targetIsShared) {
    // Private -> Shared: only "drop INTO document" nesting is offered. Line drops
    // would mean moving to the shared root level, which is not a thing.
    return nestingDrop;
  }

  if (ctx.draggedIsShared && ctx.targetIsShared) {
    if (nestingDrop) {
      // TODO(full-access): reparenting inside Shared requires membership control.
      return false;
    }
    // Pure sibling reorder within the same parent (root level included).
    return (ctx.draggedParentId ?? null) === (ctx.targetParentId ?? null);
  }

  if (!ctx.draggedIsShared && !ctx.targetIsShared) {
    // Private intra-tree moves keep the legacy behavior for every zone kind.
    return true;
  }

  // Shared -> Private is not supported.
  return false;
}

/** Where a resolved drop should be dispatched. */
export function resolveSidebarMoveRoute(
  args: { documentId: string; newParentId: string | null },
  ctx: { draggedIsShared: boolean; targetParentIdIsShared: boolean }
): SidebarMoveRoute {
  if (!ctx.draggedIsShared) {
    if (args.newParentId != null && ctx.targetParentIdIsShared) {
      return { kind: 'shared-nest-adopt', hostParentId: args.newParentId };
    }
    return { kind: 'private' };
  }
  // For shared documents: root-level documents have newParentId === null (where
  // targetParentIdIsShared is false). Sibling reorders at root or within the same
  // shared parent route to 'shared-reorder'. Note: Cross-tree drops (shared -> private)
  // are already filtered out earlier by isSidebarDropAllowed.
  if (args.newParentId == null || ctx.targetParentIdIsShared) {
    return { kind: 'shared-reorder' };
  }
  return { kind: 'blocked' };
}
