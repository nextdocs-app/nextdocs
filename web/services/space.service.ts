import { apiRequest } from '@/services/api-client';
import type {
  Space,
  SpaceAccessLevel,
  SpaceCreateInput,
  SpaceMember,
  SpaceUpdateInput,
} from '@/types/space.types';

const SPACES_PATH = '/api/v1/spaces';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function jsonHeaders(accessToken: string): Record<string, string> {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json' };
}

function spacePath(spaceId: string): string {
  return `${SPACES_PATH}/${encodeURIComponent(spaceId)}`;
}

function membersPath(spaceId: string): string {
  return `${spacePath(spaceId)}/members`;
}

export const spaceApiService = {
  /**
   * Active spaces the caller can see. `archived` swaps that for the restore
   * view: archived spaces only, limited to the ones the caller administers.
   */
  list(
    accessToken: string,
    { archived = false, signal }: { archived?: boolean; signal?: AbortSignal } = {}
  ): Promise<Space[]> {
    return apiRequest<Space[]>(archived ? `${SPACES_PATH}?archived=true` : SPACES_PATH, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  /** One space the caller can read, or any space they administer. */
  get(accessToken: string, spaceId: string, signal?: AbortSignal): Promise<Space> {
    return apiRequest<Space>(spacePath(spaceId), {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  /**
   * Stores an image a space icon can reference. Any workspace member may upload;
   * the returned id becomes an `upload` icon value on create or update.
   */
  uploadIcon(accessToken: string, file: File): Promise<{ id: string }> {
    const body = new FormData();
    body.append('file', file);

    return apiRequest<{ id: string }>(`${SPACES_PATH}/attachments`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body,
    });
  },

  /** Any workspace member may create a space; the caller becomes its owner. */
  create(accessToken: string, input: SpaceCreateInput): Promise<Space> {
    return apiRequest<Space>(SPACES_PATH, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(input),
    });
  },

  /** Rename, re-icon, or re-share. Space owner or workspace admin. */
  update(accessToken: string, spaceId: string, input: SpaceUpdateInput): Promise<Space> {
    return apiRequest<Space>(spacePath(spaceId), {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(input),
    });
  },

  /**
   * Moves the space in the caller's own sidebar order. Any caller who can read
   * the space may move it; only their navigation changes. `prevSiblingId`
   * places it after that neighbour, `nextSiblingId` before it.
   */
  move(
    accessToken: string,
    spaceId: string,
    siblings: { prevSiblingId: string | null; nextSiblingId: string | null }
  ): Promise<Space> {
    return apiRequest<Space>(`${spacePath(spaceId)}/move`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(siblings),
    });
  },

  /** Owner or workspace admin. Idempotent. */
  archive(accessToken: string, spaceId: string): Promise<Space> {
    return apiRequest<Space>(`${spacePath(spaceId)}/archive`, {
      method: 'POST',
      headers: authHeaders(accessToken),
    });
  },

  /** Owner or workspace admin. Idempotent. */
  restore(accessToken: string, spaceId: string): Promise<Space> {
    return apiRequest<Space>(`${spacePath(spaceId)}/restore`, {
      method: 'POST',
      headers: authHeaders(accessToken),
    });
  },

  /** Owner or workspace admin, and only once the space holds no documents at all. */
  remove(accessToken: string, spaceId: string): Promise<void> {
    return apiRequest<void>(
      spacePath(spaceId),
      { method: 'DELETE', headers: authHeaders(accessToken) },
      { allowEmptyData: true }
    );
  },

  /** Listed members and workspace admins only. */
  listMembers(accessToken: string, spaceId: string, signal?: AbortSignal): Promise<SpaceMember[]> {
    return apiRequest<SpaceMember[]>(membersPath(spaceId), {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  /** Owner or workspace admin. Returns the recalculated roster. */
  addMember(
    accessToken: string,
    spaceId: string,
    email: string,
    accessLevel: SpaceAccessLevel
  ): Promise<SpaceMember[]> {
    return apiRequest<SpaceMember[]>(membersPath(spaceId), {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ email, accessLevel }),
    });
  },

  /** Owner or workspace admin. The last owner cannot be demoted (409). */
  updateMemberAccess(
    accessToken: string,
    spaceId: string,
    userId: string,
    accessLevel: SpaceAccessLevel
  ): Promise<SpaceMember[]> {
    return apiRequest<SpaceMember[]>(`${membersPath(spaceId)}/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ accessLevel }),
    });
  },

  /** Owner, workspace admin, or the member themselves (leaving). */
  removeMember(accessToken: string, spaceId: string, userId: string): Promise<SpaceMember[]> {
    return apiRequest<SpaceMember[]>(`${membersPath(spaceId)}/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    });
  },
};
