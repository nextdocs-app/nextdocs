'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth.hook';
import { dispatchWorkspaceUpdated } from '@/lib/workspace-event.util';
import { workspaceApiService } from '@/services/workspace.service';
import type { Workspace, WorkspaceMember } from '@/types/workspace.types';
import { SettingsSection } from '../SettingsPrimitives';
import { WorkspaceInviteSection } from '../workspace/WorkspaceInviteSection';
import { WorkspaceMemberList, type PeopleNotice } from '../workspace/WorkspaceMemberList';
import {
  WorkspacePanelError,
  WorkspacePanelLoading,
  WorkspacePanelSignedOut,
} from '../workspace/WorkspacePanelStates';
import { canManageMembers } from '../workspace/workspace-role.util';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The People page. Everyone with a membership can read the roster; the invite
 * administration below it is mounted only for owners and admins. A member sees
 * exactly what the API lets them read, and no dead controls.
 */
export function WorkspacePeoplePanel() {
  const { isAuthenticated, isInitializing, accessToken, user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PeopleNotice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    Promise.all([
      workspaceApiService.getCurrent(accessToken, controller.signal),
      workspaceApiService.listMembers(accessToken, controller.signal),
    ])
      .then(([nextWorkspace, roster]) => {
        if (cancelled) {
          return;
        }

        setWorkspace(nextWorkspace);
        setMembers(roster);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setLoadError(messageFor(error, 'Could not load the workspace members.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isAuthenticated, accessToken, reloadKey]);

  const retry = () => {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  if (isInitializing) {
    return <WorkspacePanelLoading label="Loading account…" />;
  }

  if (!isAuthenticated) {
    return <WorkspacePanelSignedOut />;
  }

  if (isLoading && !workspace) {
    return <WorkspacePanelLoading label="Loading people…" />;
  }

  if (loadError && !workspace) {
    return <WorkspacePanelError message={loadError} onRetry={retry} />;
  }

  if (!workspace) {
    return (
      <WorkspacePanelError message="You are not a member of this workspace." onRetry={retry} />
    );
  }

  const handleRosterChange = (roster: WorkspaceMember[]) => {
    setMembers(roster);
    const self = roster.find((member) => member.userId === user?.id);
    const nextWorkspace: Workspace = {
      ...workspace,
      memberCount: roster.length,
      role: self?.role ?? workspace.role,
    };
    setWorkspace(nextWorkspace);
    dispatchWorkspaceUpdated(nextWorkspace);
  };

  const canManage = canManageMembers(workspace.role);

  return (
    <div className="flex flex-col gap-6">
      {loadError ? (
        <p role="alert" className="text-[12.5px] leading-snug text-destructive">
          {loadError}
        </p>
      ) : null}

      {notice ? (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`text-[12.5px] leading-snug ${
            notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <SettingsSection
        title="Members"
        description={`${members.length} ${members.length === 1 ? 'person has' : 'people have'} access to this workspace.`}
      >
        <WorkspaceMemberList
          members={members}
          actorRole={workspace.role}
          selfId={user?.id ?? null}
          accessToken={accessToken ?? ''}
          onRosterChange={handleRosterChange}
          onRefresh={retry}
          onNotice={setNotice}
        />
      </SettingsSection>

      {canManage ? (
        <WorkspaceInviteSection accessToken={accessToken ?? ''} actorRole={workspace.role} />
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Only workspace owners and admins can invite people or change roles.
        </p>
      )}
    </div>
  );
}
