'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/services/api-client';
import { workspaceApiService } from '@/services/workspace.service';
import type { WorkspaceRole } from '@/types/auth.types';
import type { WorkspaceInvite } from '@/types/workspace.types';
import type { PeopleNotice } from './WorkspaceMemberList';
import { canGrantRole, canManageMembers, workspaceRoleLabel } from './workspace-role.util';

const INVITE_PAGE_SIZE = 20;

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isEmailDeliveryMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

function formatExpiry(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function NoticeText({ notice }: { notice: PeopleNotice }) {
  return (
    <p
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={`text-[12.5px] leading-snug ${
        notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {notice.message}
    </p>
  );
}

/**
 * Lists pending workspace invites with resend and revoke controls. Mounted
 * when the "Pending" tab is selected in the workspace people panel. Only
 * owners and admins have access to pending invites.
 */
export function WorkspacePendingInvites({
  accessToken,
  actorRole,
  reloadKey = 0,
  onNotice,
}: {
  accessToken: string;
  actorRole: WorkspaceRole;
  reloadKey?: number;
  onNotice?: (notice: PeopleNotice) => void;
}) {
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PeopleNotice | null>(null);
  const [page, setPage] = useState(0);
  const [isLastPage, setIsLastPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [internalReloadKey, setInternalReloadKey] = useState(0);

  // One surface per notice: the panel shows it in its own notice line, so the
  // list keeps its local copy only when it is rendered on its own.
  const notify = (notice: PeopleNotice) => {
    if (onNotice) {
      onNotice(notice);
      return;
    }
    setFeedback(notice);
  };

  useEffect(() => {
    if (!canManageMembers(actorRole)) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setIsLoadingInvites(true);
    setInviteError(null);

    workspaceApiService
      .listInvites(accessToken, 0, INVITE_PAGE_SIZE, controller.signal)
      .then((next) => {
        if (cancelled) {
          return;
        }

        setInvites(next.content);
        setPage(next.number);
        setIsLastPage(next.last);
        setInviteError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setInviteError(messageFor(error, 'Could not load pending invites.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingInvites(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, actorRole, reloadKey, internalReloadKey]);

  const retryInvites = () => {
    setIsLoadingInvites(true);
    setInviteError(null);
    setInternalReloadKey((key) => key + 1);
  };

  const loadMore = async () => {
    if (isLoadingMore || isLastPage) {
      return;
    }

    setIsLoadingMore(true);
    setInviteError(null);
    try {
      const next = await workspaceApiService.listInvites(accessToken, page + 1, INVITE_PAGE_SIZE);
      setInvites((current) => {
        const seen = new Set(current.map((invite) => invite.id));
        return [...current, ...next.content.filter((invite) => !seen.has(invite.id))];
      });
      setPage(next.number);
      setIsLastPage(next.last);
    } catch (error) {
      setInviteError(messageFor(error, 'Could not load more invites.'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleResend = async (invite: WorkspaceInvite) => {
    setBusyInvite(`resend:${invite.id}`);
    setFeedback(null);
    try {
      const created = await workspaceApiService.resendInvite(accessToken, invite.id);
      setInvites((current) =>
        current.map((entry) =>
          entry.id === invite.id
            ? { ...entry, role: created.role, expiresAt: created.expiresAt }
            : entry
        )
      );
      notify({ kind: 'status', message: `Invitation resent to ${invite.email}.` });
    } catch (error) {
      notify({
        kind: 'error',
        message: isEmailDeliveryMissing(error)
          ? 'Invites need email delivery, which is not configured on this instance.'
          : messageFor(error, 'Could not resend the invitation.'),
      });
    } finally {
      setBusyInvite(null);
    }
  };

  const handleRevoke = async (invite: WorkspaceInvite) => {
    setBusyInvite(`revoke:${invite.id}`);
    setFeedback(null);
    try {
      await workspaceApiService.revokeInvite(accessToken, invite.id);
      setInvites((current) => current.filter((entry) => entry.id !== invite.id));
      notify({ kind: 'status', message: `Invitation to ${invite.email} revoked.` });
    } catch (error) {
      notify({
        kind: 'error',
        message: messageFor(error, 'Could not revoke the invitation.'),
      });
    } finally {
      setBusyInvite(null);
    }
  };

  if (!canManageMembers(actorRole)) {
    return null;
  }

  if (isLoadingInvites && invites.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">Loading invites…</p>
      </div>
    );
  }

  if (inviteError && invites.length === 0) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-2 py-10 text-center"
      >
        <p className="text-[13px] text-destructive">{inviteError}</p>
        <button
          type="button"
          onClick={retryInvites}
          className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-foreground/[0.06] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Try again
        </button>
      </div>
    );
  }

  if (invites.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-12 text-center">
        {feedback ? <NoticeText notice={feedback} /> : null}
        <p className="text-[13px] text-muted-foreground">No pending invites.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {feedback ? <NoticeText notice={feedback} /> : null}

      <div
        role="region"
        aria-label="Pending invites"
        tabIndex={0}
        className="w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-lg"
      >
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-[12px] font-medium text-muted-foreground/80">
              <th scope="col" className="py-2.5 pl-1 pr-4 font-medium">
                Invitee
              </th>
              <th scope="col" className="py-2.5 px-4 font-medium">
                Role
              </th>
              <th scope="col" className="py-2.5 px-4 font-medium text-center">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {invites.map((invite) => {
              const canManage = canGrantRole(actorRole, invite.role);
              const expiry = formatExpiry(invite.expiresAt);
              const isResending = busyInvite === `resend:${invite.id}`;
              const isRevoking = busyInvite === `revoke:${invite.id}`;
              const initial = (invite.email[0] ?? '?').toUpperCase();

              return (
                <tr key={invite.id} className="group transition-colors hover:bg-muted/30">
                  <td className="py-3 pl-1 pr-4 align-middle">
                    <div className="flex items-center gap-3">
                      <div
                        aria-hidden="true"
                        className="size-8 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground font-medium text-[12px] border border-border/50 shrink-0 select-none"
                      >
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium leading-snug">
                          {invite.email}
                        </p>
                        <p className="truncate text-[12px] leading-snug text-muted-foreground/70">
                          Invited{expiry ? ` · Expires ${expiry}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 align-middle whitespace-nowrap">
                    <div className="-ml-2 flex items-center">
                      <span className="inline-flex select-none items-center rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground/80">
                        {workspaceRoleLabel(invite.role)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 align-middle text-center whitespace-nowrap">
                    {canManage ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleResend(invite)}
                          disabled={busyInvite !== null}
                          className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {isResending ? 'Sending…' : 'Resend'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(invite)}
                          disabled={busyInvite !== null}
                          className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {isRevoking ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-7 items-center justify-center">
                        <span className="text-[12px] text-muted-foreground/70">Owner-managed</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inviteError ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {inviteError}
        </p>
      ) : null}

      {!isLastPage ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
            className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
