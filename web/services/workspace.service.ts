import { apiRequest } from '@/services/api-client';
import type { Workspace } from '@/types/workspace.types';

export const workspaceApiService = {
  /** Identity and the caller's role for the workspace chrome. */
  getCurrent(accessToken: string, signal?: AbortSignal): Promise<Workspace> {
    return apiRequest<Workspace>('/api/v1/workspaces/current', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
  },
};
