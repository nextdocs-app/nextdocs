import { apiRequest } from '@/services/api-client';
import type { WorkspaceRole } from '@/types/auth.types';
import type {
  Workspace,
  WorkspaceInvite,
  WorkspaceInviteCreated,
  WorkspaceInviteEmailResult,
  WorkspaceMember,
  WorkspacePage,
  WorkspaceUpdateInput,
} from '@/types/workspace.types';

const CURRENT_PATH = '/api/v1/workspaces/current';
const MEMBERS_PATH = `${CURRENT_PATH}/members`;
const INVITES_PATH = `${CURRENT_PATH}/invites`;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

export const workspaceApiService = {
  /** Identity and the caller's role for the workspace chrome. */
  getCurrent(accessToken: string, signal?: AbortSignal): Promise<Workspace> {
    return apiRequest<Workspace>(CURRENT_PATH, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  /** Owner-only rename and icon assignment. Absent fields stay unchanged. */
  updateCurrent(accessToken: string, input: WorkspaceUpdateInput): Promise<Workspace> {
    return apiRequest<Workspace>(CURRENT_PATH, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /** Owner-only icon upload. The returned id becomes an `upload` icon value. */
  uploadIcon(accessToken: string, file: File): Promise<{ id: string }> {
    const body = new FormData();
    body.append('file', file);

    return apiRequest<{ id: string }>(`${CURRENT_PATH}/attachments`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body,
    });
  },

  /** The full roster. Any member can read it. */
  listMembers(accessToken: string, signal?: AbortSignal): Promise<WorkspaceMember[]> {
    return apiRequest<WorkspaceMember[]>(MEMBERS_PATH, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  /** Owner-only role change. Returns the recalculated roster. */
  updateMemberRole(
    accessToken: string,
    userId: string,
    role: WorkspaceRole
  ): Promise<WorkspaceMember[]> {
    return apiRequest<WorkspaceMember[]>(`${MEMBERS_PATH}/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  },

  /** Owner or admin. Returns the recalculated roster. */
  removeMember(accessToken: string, userId: string): Promise<WorkspaceMember[]> {
    return apiRequest<WorkspaceMember[]>(`${MEMBERS_PATH}/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    });
  },

  /** Owner or admin. Pending invites only. */
  listInvites(
    accessToken: string,
    page = 0,
    size = 20,
    signal?: AbortSignal
  ): Promise<WorkspacePage<WorkspaceInvite>> {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      sort: 'createdAt,desc',
    });

    return apiRequest<WorkspacePage<WorkspaceInvite>>(`${INVITES_PATH}?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  /** Owner or admin. Each address gets its own result. */
  createInvites(
    accessToken: string,
    emails: string[],
    role: WorkspaceRole
  ): Promise<WorkspaceInviteEmailResult[]> {
    return apiRequest<WorkspaceInviteEmailResult[]>(INVITES_PATH, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails, role }),
    });
  },

  /** Owner or admin. Rotates the token and resets the expiry. */
  resendInvite(accessToken: string, inviteId: string): Promise<WorkspaceInviteCreated> {
    return apiRequest<WorkspaceInviteCreated>(
      `${INVITES_PATH}/${encodeURIComponent(inviteId)}/resend`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
      }
    );
  },

  /** Owner or admin. The invite is deleted; the address can no longer register. */
  revokeInvite(accessToken: string, inviteId: string): Promise<void> {
    return apiRequest<void>(
      `${INVITES_PATH}/${encodeURIComponent(inviteId)}`,
      {
        method: 'DELETE',
        headers: authHeaders(accessToken),
      },
      { allowEmptyData: true }
    );
  },
};
