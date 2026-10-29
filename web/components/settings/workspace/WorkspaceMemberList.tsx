'use client';

import { useState } from 'react';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import { ShareAvatar } from '@/components/share/CollaboratorRow';
import { ApiError } from '@/services/api-client';
import { workspaceApiService } from '@/services/workspace.service';
import type { WorkspaceRole } from '@/types/auth.types';
import type { WorkspaceMember } from '@/types/workspace.types';
import { MemberSpacesBadge } from './MemberSpacesBadge';
import {
  canManageMembers,
  memberRoleOptions,
  workspaceRoleLabel,
  type WorkspaceMemberAction,
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
  const [pendingSelfDemotion, setPendingSelfDemotion] = useState<{
    member: WorkspaceMember;
    newRole: WorkspaceRole;
  } | null>(null);
  const [isDemoting, setIsDemoting] = useState(false);
  const ownerCount = members.filter((member) => member.role === 'OWNER').length;
  // The API omits space memberships unless the caller can manage members, so the
  // column is management-only: who belongs to a space is roster data, not content.
  const showSpaces = canManageMembers(actorRole);

  const applyRoleChange = async (member: WorkspaceMember, role: WorkspaceRole) => {
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

  const handleActionSelect = (member: WorkspaceMember, action: WorkspaceMemberAction) => {
    if (action === 'REMOVE') {
      setPendingRemoval(member);
      return;
    }

    if (action === member.role) {
      return;
    }

    const isSelf = member.userId === selfId;
    if (isSelf) {
      setPendingSelfDemotion({ member, newRole: action });
      return;
    }

    void applyRoleChange(member, action);
  };

  const handleConfirmSelfDemotion = async () => {
    if (!pendingSelfDemotion) {
      return;
    }

    const { member, newRole } = pendingSelfDemotion;
    setIsDemoting(true);
    try {
      await applyRoleChange(member, newRole);
      setPendingSelfDemotion(null);
    } finally {
      setIsDemoting(false);
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
        <div
          tabIndex={0}
          role="region"
          aria-label="Workspace members"
          className="table-wrapper overflow-x-auto w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[12px] font-medium text-muted-foreground/80">
                <th scope="col" className="py-2.5 pl-1 pr-4 font-medium text-left">
                  User
                </th>
                {showSpaces ? (
                  <th scope="col" className="py-2.5 px-4 font-medium text-left whitespace-nowrap">
                    Spaces
                  </th>
                ) : null}
                <th scope="col" className="py-2.5 px-4 font-medium text-left whitespace-nowrap">
                  Role
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {members.map((member) => {
                const isSelf = member.userId === selfId;
                const isRoleBusy = busyKey === `role:${member.userId}`;
                const joinedAt = formatJoinedAt(member.joinedAt);
                const name = displayName(member);
                const options = memberRoleOptions(actorRole, member.role, {
                  isSelf,
                  ownerCount,
                });
                const canInteract = options.length > 0;

                return (
                  <tr key={member.userId} className="group transition-colors hover:bg-muted/30">
                    {/* User */}
                    <td className="py-3 pl-1 pr-4 align-middle">
                      <div className="flex items-center gap-3">
                        <MemberAvatar member={member} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13.5px] font-medium leading-snug">
                              {name}
                            </span>
                            {isSelf && (
                              <span className="flex-shrink-0 text-[11.5px] font-normal text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[12px] leading-snug text-muted-foreground/70">
                            {member.email}
                            {joinedAt ? ` · Joined ${joinedAt}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Spaces */}
                    {showSpaces ? (
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        <MemberSpacesBadge spaces={member.spaces} memberName={name} />
                      </td>
                    ) : null}

                    {/* Role */}
                    <td className="py-3 px-4 align-middle whitespace-nowrap">
                      {canInteract ? (
                        <div className="-ml-2 flex items-center">
                          <AccessDropdown<WorkspaceMemberAction>
                            value={member.role}
                            options={options}
                            onChange={(action) => handleActionSelect(member, action)}
                            disabled={isRoleBusy}
                            align="left"
                            ariaLabel={`Role for ${name}`}
                            muted
                          />
                        </div>
                      ) : (
                        <div className="-ml-2 flex items-center">
                          <span className="inline-flex select-none items-center rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground/80">
                            {workspaceRoleLabel(member.role)}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      <ConfirmationModal
        isOpen={pendingSelfDemotion !== null}
        title={`Demote yourself to ${
          pendingSelfDemotion ? workspaceRoleLabel(pendingSelfDemotion.newRole) : ''
        }?`}
        description="You will lose owner permissions and will not be able to restore them yourself unless another owner promotes you."
        confirmLabel="Demote"
        tone="danger"
        isConfirming={isDemoting}
        onConfirm={() => void handleConfirmSelfDemotion()}
        onCancel={() => {
          if (!isDemoting) {
            setPendingSelfDemotion(null);
          }
        }}
      />
    </>
  );
}
