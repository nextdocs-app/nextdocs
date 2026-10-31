import type { DocumentAccessLevel } from '@/services/document.service';

/**
 * Drop rules for the sidebar's two document trees (Private / Shared).
 *
 * Kept pure and side-effect free so both the drag-over visual gating and the
 * drop handler enforce identical policy.
 *
 * Note: moving a document between two shared documents requires OWNER access
 * on the dragged document, so an editor cannot expose someone else's document
 * to the target parent's collaborators.
 * Sibling reordering inside the Shared section is allowed.
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
  /** Access level of the dragged document for the current user. */
  draggedAccessLevel?: DocumentAccessLevel | null;
  /** Whether the target document has collaborators. */
  targetHasCollaborators?: boolean;
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
    // The user owns their private document, so grafting it into a shared target is allowed.
    return nestingDrop;
  }

  if (ctx.draggedIsShared && ctx.targetIsShared) {
    if (nestingDrop) {
      // Shared→shared reparenting requires owner access on the dragged document so an editor
      // cannot expose someone else's document to the target parent's collaborators.
      return ctx.draggedAccessLevel === 'OWNER';
    }
    // Pure sibling reorder within the same parent (root level included).
    return (ctx.draggedParentId ?? null) === (ctx.targetParentId ?? null);
  }

  if (!ctx.draggedIsShared && !ctx.targetIsShared) {
    // Private intra-tree moves keep the legacy behavior for every zone kind.
    return true;
  }

  // Shared -> Private: only allowed if the caller owns the dragged document.
  if (ctx.draggedIsShared && !ctx.targetIsShared) {
    return ctx.draggedAccessLevel === 'OWNER';
  }

  return false;
}

/** Where a resolved drop should be dispatched. */
export function resolveSidebarMoveRoute(
  args: { documentId: string; newParentId: string | null },
  ctx: {
    draggedIsShared: boolean;
    targetParentIdIsShared: boolean;
    draggedAccessLevel?: DocumentAccessLevel | null;
  }
): SidebarMoveRoute {
  if (!ctx.draggedIsShared) {
    if (args.newParentId != null && ctx.targetParentIdIsShared) {
      return { kind: 'shared-nest-adopt', hostParentId: args.newParentId };
    }
    return { kind: 'private' };
  }
  // For shared documents: root-level documents have newParentId === null (where
  // targetParentIdIsShared is false). Sibling reorders at root route to 'shared-reorder'.
  if (args.newParentId == null) {
    return { kind: 'shared-reorder' };
  }
  if (ctx.targetParentIdIsShared) {
    if (ctx.draggedAccessLevel !== 'OWNER') {
      return { kind: 'blocked' };
    }
    return { kind: 'shared-reorder' };
  }
  if (!ctx.targetParentIdIsShared && ctx.draggedAccessLevel === 'OWNER') {
    return { kind: 'private' };
  }
  return { kind: 'blocked' };
}
