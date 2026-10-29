import type { IconRequestPayload } from '@/lib/document-icon.util';
import type { DocumentIcon } from '@/types/document.types';
import type { WorkspaceRole } from '@/types/auth.types';

/** Wire shape of `GET /api/v1/workspaces/current`. */
export interface Workspace {
  id: string;
  name: string;
  icon: DocumentIcon | null;
  role: WorkspaceRole;
  memberCount: number;
}

/**
 * PATCH body for the workspace. Absent fields stay unchanged, so callers send
 * only what the member actually edited.
 */
export interface WorkspaceUpdateInput {
  name?: string;
  icon?: IconRequestPayload;
}

/** Wire shape of a space summary attached to a workspace member. */
export interface WorkspaceMemberSpaceSummary {
  id: string;
  name: string;
  icon?: DocumentIcon | null;
  accessLevel: 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';
}

/** Wire shape of `GET /api/v1/workspaces/current/members`. */
export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: WorkspaceRole;
  joinedAt: string;
  spaces?: WorkspaceMemberSpaceSummary[];
}

/** Wire shape of a pending invite. Accepted and revoked invites are never listed. */
export interface WorkspaceInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  createdAt: string;
}

/** Per-email outcome of an invite batch. */
export type WorkspaceInviteStatus = 'INVITED' | 'ALREADY_MEMBER' | 'INVALID_EMAIL';

/** The invite as created. The signup link itself only ever travels by email. */
export interface WorkspaceInviteCreated {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
}

export interface WorkspaceInviteEmailResult {
  email: string;
  status: WorkspaceInviteStatus;
  invite?: WorkspaceInviteCreated | null;
}

/** Spring's `PagedResponse` envelope. */
export interface WorkspacePage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
}
