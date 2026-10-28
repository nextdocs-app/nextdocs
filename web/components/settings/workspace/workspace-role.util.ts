import type { DropdownOption } from '@/components/share/AccessDropdown';
import type { WorkspaceRole } from '@/types/auth.types';

/** Mirrors the server's `WorkspaceRole` capabilities, for hiding dead actions. */
export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

export const WORKSPACE_ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: 'Full control of the workspace and everyone in it',
  ADMIN: 'Can invite people and remove plain members',
  MEMBER: 'Can view the workspace and its member roster',
};

export function workspaceRoleLabel(role: WorkspaceRole): string {
  return WORKSPACE_ROLE_LABELS[role];
}

/** Admins and owners can invite and remove plain members. */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role !== 'MEMBER';
}

/** Owners grant any role; admins can only invite/remove plain members. */
export function canGrantRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  return actor === 'OWNER' || target === 'MEMBER';
}

/** Nobody removes themselves, and admins never touch privileged members. */
export function canRemoveMember(
  actor: WorkspaceRole,
  target: WorkspaceRole,
  isSelf: boolean
): boolean {
  if (isSelf) {
    return false;
  }

  return actor === 'OWNER' || (actor === 'ADMIN' && target === 'MEMBER');
}

/**
 * Owners can change every role, including their own only when another owner
 * exists — the API rejects demoting the last owner.
 */
export function canChangeRole(
  actor: WorkspaceRole,
  { isSelf, ownerCount }: { isSelf: boolean; ownerCount: number }
): boolean {
  return actor === 'OWNER' && (!isSelf || ownerCount > 1);
}

/** Roles the actor may hand out through the invite form or role dropdown. */
export function grantableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  return actor === 'OWNER' ? ['OWNER', 'ADMIN', 'MEMBER'] : ['MEMBER'];
}

export function roleOptions(actor: WorkspaceRole): DropdownOption<WorkspaceRole>[] {
  const roles = grantableRoles(actor);
  // Most privileged first, matching the share dropdown's ordering.
  return ['OWNER', 'ADMIN', 'MEMBER']
    .filter((role): role is WorkspaceRole => roles.includes(role as WorkspaceRole))
    .map((role) => ({
      value: role,
      label: WORKSPACE_ROLE_LABELS[role],
      description: WORKSPACE_ROLE_DESCRIPTIONS[role],
    }));
}
