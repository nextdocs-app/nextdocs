'use client';

import { useState } from 'react';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import { ShareAvatar } from '@/components/share/CollaboratorRow';
import { Trash } from '@/icons';
import { ApiError } from '@/services/api-client';
import { workspaceApiService } from '@/services/workspace.service';
import type { WorkspaceRole } from '@/types/auth.types';
import type { WorkspaceMember } from '@/types/workspace.types';
import {
  canChangeRole,
  canRemoveMember,
  roleOptions,
  workspaceRoleLabel,
} from './workspace-role.util';

export interface PeopleNotice {
  kind: 'status' | 'error';
  message: string;
}

function displayName(member: WorkspaceMember): string {
  return member.displayName?.trim() || member.email;
}

function formatJoinedAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  if (member.avatarUrl) {
    return (
      // Avatars are user-provided URLs; next/image would add a proxy hop for a
      // 32px crop. `no-referrer` keeps the workspace host out of their logs.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
      />
    );
  }

  return <ShareAvatar seed={member.userId} label={displayName(member)} />;
}

/**
 * The roster everyone can read. The controls follow the server's role rules:
 * only owners change roles, admins remove plain members, and nobody removes
 * themselves. The API stays the authority; a rejected action refreshes the
 * roster so the UI stops offering it.
 */
export function WorkspaceMemberList({
  members,
  actorRole,
  selfId,
  accessToken,
  onRosterChange,
  onRefresh,
  onNotice,
}: {
  members: WorkspaceMember[];
  actorRole: WorkspaceRole;
  selfId: string | null;
  accessToken: string;
  onRosterChange: (members: WorkspaceMember[]) => void;
  onRefresh: () => void;
  onNotice: (notice: PeopleNotice | null) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const ownerCount = members.filter((member) => member.role === 'OWNER').length;

  const handleRoleChange = async (member: WorkspaceMember, role: WorkspaceRole) => {
    if (role === member.role) {
      return;
    }

    setBusyKey(`role:${member.userId}`);
    onNotice(null);
    try {
      const roster = await workspaceApiService.updateMemberRole(accessToken, member.userId, role);
      onRosterChange(roster);
      onNotice({
        kind: 'status',
        message: `${displayName(member)} is now ${workspaceRoleLabel(role)}.`,
      });
    } catch (error) {
      onNotice({ kind: 'error', message: messageFor(error, 'Could not change the role.') });
      // A role changed underneath the panel (or the member left). Reload so the
      // controls reflect the caller's current access instead of failing twice.
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        onRefresh();
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemove = async () => {
    if (!pendingRemoval) {
      return;
    }

    const target = pendingRemoval;
    setIsRemoving(true);
    onNotice(null);
    try {
      const roster = await workspaceApiService.removeMember(accessToken, target.userId);
      onRosterChange(roster);
      onNotice({
        kind: 'status',
        message: `${displayName(target)} was removed from the workspace.`,
      });
      setPendingRemoval(null);
    } catch (error) {
      onNotice({ kind: 'error', message: messageFor(error, 'Could not remove the member.') });
      setPendingRemoval(null);
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404 || error.status === 409)
      ) {
        onRefresh();
      }
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <>
      {members.length === 0 ? (
        <p className="py-3.5 text-[13px] text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {members.map((member) => {
            const isSelf = member.userId === selfId;
            const canChange = canChangeRole(actorRole, { isSelf, ownerCount });
            const canRemove = canRemoveMember(actorRole, member.role, isSelf);
            const isRoleBusy = busyKey === `role:${member.userId}`;
            const joinedAt = formatJoinedAt(member.joinedAt);
            const name = displayName(member);

            return (
              <li key={member.userId} className="flex items-center gap-3 py-3">
                <MemberAvatar member={member} />

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13.5px] font-medium leading-snug">
                      {name}
                    </span>
                    {isSelf ? (
                      <span className="flex-shrink-0 text-[12px] font-normal text-muted-foreground">
                        (you)
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] leading-snug text-muted-foreground/70">
                    {member.email}
                    {joinedAt ? ` · Joined ${joinedAt}` : ''}
                  </p>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  {canChange ? (
                    <AccessDropdown<WorkspaceRole>
                      value={member.role}
                      options={roleOptions(actorRole)}
                      onChange={(role) => void handleRoleChange(member, role)}
                      disabled={isRoleBusy}
                      align="right"
                      ariaLabel={`Role for ${name}`}
                      muted
                    />
                  ) : (
                    <span className="inline-flex select-none items-center px-2 py-1 text-[13px] font-medium text-muted-foreground/80">
                      {workspaceRoleLabel(member.role)}
                    </span>
                  )}

                  {canRemove ? (
                    <button
                      type="button"
                      onClick={() => setPendingRemoval(member)}
                      aria-label={`Remove ${name}`}
                      title={`Remove ${name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                    >
                      <Trash size={14} />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmationModal
        isOpen={pendingRemoval !== null}
        title={`Remove ${pendingRemoval ? displayName(pendingRemoval) : 'this member'}?`}
        description="They lose access immediately, and any active session is signed out. They can only come back if someone invites them again."
        confirmLabel="Remove"
        tone="danger"
        isConfirming={isRemoving}
        onConfirm={() => void handleRemove()}
        onCancel={() => {
          if (!isRemoving) {
            setPendingRemoval(null);
          }
        }}
      />
    </>
  );
}
