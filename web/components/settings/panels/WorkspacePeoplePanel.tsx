'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '@/hooks/useAuth.hook';
import { Plus } from '@/icons';
import { dispatchWorkspaceUpdated } from '@/lib/workspace-event.util';
import { workspaceApiService } from '@/services/workspace.service';
import type { Workspace, WorkspaceMember } from '@/types/workspace.types';
import { InviteMembersModal } from '../workspace/InviteMembersModal';
import { WorkspaceMemberList, type PeopleNotice } from '../workspace/WorkspaceMemberList';
import {
  WorkspacePanelError,
  WorkspacePanelLoading,
  WorkspacePanelSignedOut,
} from '../workspace/WorkspacePanelStates';
import { WorkspacePendingInvites } from '../workspace/WorkspacePendingInvites';
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
  const [activeTab, setActiveTab] = useState<'members' | 'pending'>('members');
  const [pendingReloadKey, setPendingReloadKey] = useState(0);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const membersTabRef = useRef<HTMLButtonElement>(null);
  const pendingTabRef = useRef<HTMLButtonElement>(null);

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
  const currentTab = canManage ? activeTab : 'members';

  const selectTab = (tab: 'members' | 'pending') => {
    setActiveTab(tab);
    (tab === 'members' ? membersTabRef : pendingTabRef).current?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canManage || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
      return;
    }
    event.preventDefault();
    selectTab(currentTab === 'members' ? 'pending' : 'members');
  };

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

      <section>
        <div className="flex items-center justify-between border-b border-border pb-0">
          <div
            role="tablist"
            aria-label="People"
            onKeyDown={handleTabKeyDown}
            className="flex items-center gap-1 select-none"
          >
            <button
              ref={membersTabRef}
              type="button"
              role="tab"
              id="tab-members"
              aria-controls="panel-members"
              aria-selected={currentTab === 'members'}
              tabIndex={currentTab === 'members' ? 0 : -1}
              onClick={() => setActiveTab('members')}
              className={`relative px-3 py-2 text-[14px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                currentTab === 'members'
                  ? 'text-foreground font-semibold after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[var(--nd-brand)]'
                  : 'text-muted-foreground/70 font-medium hover:text-foreground'
              }`}
            >
              Members
            </button>
            {canManage ? (
              <button
                ref={pendingTabRef}
                type="button"
                role="tab"
                id="tab-pending"
                aria-controls="panel-pending"
                aria-selected={currentTab === 'pending'}
                tabIndex={currentTab === 'pending' ? 0 : -1}
                onClick={() => setActiveTab('pending')}
                className={`relative px-3 py-2 text-[14px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  currentTab === 'pending'
                    ? 'text-foreground font-semibold after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[var(--nd-brand)]'
                    : 'text-muted-foreground/70 font-medium hover:text-foreground'
                }`}
              >
                Pending
              </button>
            ) : null}
          </div>

          {canManage ? (
            <div className="pb-1.5">
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--nd-brand)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--nd-brand-foreground)] shadow-xs transition-colors hover:bg-[var(--nd-brand-hover)] active:bg-[var(--nd-brand-active)] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Plus size={13} strokeWidth={2.5} />
                <span>Add member</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col pt-3">
          {currentTab === 'members' ? (
            <div id="panel-members" role="tabpanel" aria-labelledby="tab-members">
              <WorkspaceMemberList
                members={members}
                actorRole={workspace.role}
                selfId={user?.id ?? null}
                accessToken={accessToken ?? ''}
                onRosterChange={handleRosterChange}
                onRefresh={retry}
                onNotice={setNotice}
              />
            </div>
          ) : (
            <div id="panel-pending" role="tabpanel" aria-labelledby="tab-pending">
              <WorkspacePendingInvites
                accessToken={accessToken ?? ''}
                actorRole={workspace.role}
                reloadKey={pendingReloadKey}
                onNotice={setNotice}
              />
            </div>
          )}
        </div>
      </section>

      {!canManage ? (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Only workspace owners and admins can invite people or change roles.
        </p>
      ) : null}

      {canManage ? (
        <InviteMembersModal
          isOpen={isInviteModalOpen}
          accessToken={accessToken ?? ''}
          actorRole={workspace.role}
          onClose={() => setIsInviteModalOpen(false)}
          onInvited={() => {
            // Invitees are not members yet, so only the pending list changes.
            setPendingReloadKey((key) => key + 1);
            setActiveTab('pending');
          }}
          onNotice={setNotice}
        />
      ) : null}
    </div>
  );
}
