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
