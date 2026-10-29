import type { Workspace } from '@/types/workspace.types';

/** Fired in-tab when a settings mutation changes the workspace identity. */
export const WORKSPACE_UPDATED_EVENT = 'nextdocs:workspace-updated';

/**
 * Keeps chrome that reads `useWorkspace` (the rail lockup) in step with a
 * settings edit without introducing a second workspace store. Cross-tab sync is
 * deliberately out of scope; the next fetch reconciles other tabs.
 */
export function dispatchWorkspaceUpdated(workspace: Workspace): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<Workspace>(WORKSPACE_UPDATED_EVENT, { detail: workspace }));
}
