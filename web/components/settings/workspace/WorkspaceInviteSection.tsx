'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import { ApiError } from '@/services/api-client';
import { workspaceApiService } from '@/services/workspace.service';
import type { WorkspaceRole } from '@/types/auth.types';
import type { WorkspaceInvite } from '@/types/workspace.types';
import { SettingsSection } from '../SettingsPrimitives';
import {
  canGrantRole,
  canManageMembers,
  grantableRoles,
  roleOptions,
  workspaceRoleLabel,
} from './workspace-role.util';

const INVITE_PAGE_SIZE = 20;

type InviteResult = {
  kind: 'success' | 'warning' | 'error';
  message: string;
};

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

/**
 * Invites are only meaningful to owners and admins: members cannot read the
 * pending list, so the whole section is mounted by the panel only when the
 * caller can manage membership. The form and row actions additionally mirror
 * `WorkspaceRole.canGrant`, which limits admins to plain-member invites.
 */
export function WorkspaceInviteSection({
  accessToken,
  actorRole,
}: {
  accessToken: string;
  actorRole: WorkspaceRole;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('MEMBER');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [isLastPage, setIsLastPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // An owner may have been demoted while the section stayed mounted; fall back
  // to the one role an admin can hand out instead of submitting a forbidden one.
  const allowedRoles = grantableRoles(actorRole);
  const effectiveRole = allowedRoles.includes(role) ? role : allowedRoles[0];

  useEffect(() => {
    if (!canManageMembers(actorRole)) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

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
  }, [accessToken, actorRole, reloadKey]);

  const retryInvites = () => {
    setIsLoadingInvites(true);
    setInviteError(null);
    setReloadKey((key) => key + 1);
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

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!address || !canManageMembers(actorRole)) {
      return;
    }

    setIsSending(true);
    setResult(null);
    try {
      const results = await workspaceApiService.createInvites(
        accessToken,
        [address],
        effectiveRole
      );
      const outcome = results[0];
      if (!outcome) {
        setResult({ kind: 'error', message: 'The invite could not be created.' });
        return;
      }

      if (outcome.status === 'INVITED' && outcome.invite) {
        const created = outcome.invite;
        setInvites((current) => [
          {
            id: created.id,
            email: created.email,
            role: created.role,
            expiresAt: created.expiresAt,
            createdAt: new Date().toISOString(),
          },
          ...current.filter((invite) => invite.id !== created.id && invite.email !== created.email),
        ]);
        setResult({ kind: 'success', message: `Invitation emailed to ${outcome.email}.` });
        setEmail('');
      } else if (outcome.status === 'ALREADY_MEMBER') {
        setResult({ kind: 'warning', message: `${outcome.email} is already a member.` });
      } else {
        setResult({
          kind: 'error',
          message: `${outcome.email} is not a valid email address.`,
        });
      }
    } catch (error) {
      setResult({
        kind: 'error',
        message: isEmailDeliveryMissing(error)
          ? 'Invites need email delivery, which is not configured on this instance.'
          : messageFor(error, 'Could not send the invitation.'),
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleResend = async (invite: WorkspaceInvite) => {
    setBusyInvite(`resend:${invite.id}`);
    setResult(null);
    try {
      const created = await workspaceApiService.resendInvite(accessToken, invite.id);
      setInvites((current) =>
        current.map((entry) =>
          entry.id === invite.id
            ? { ...entry, role: created.role, expiresAt: created.expiresAt }
            : entry
        )
      );
      setResult({ kind: 'success', message: `Invitation resent to ${invite.email}.` });
    } catch (error) {
      setResult({
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
    setResult(null);
    try {
      await workspaceApiService.revokeInvite(accessToken, invite.id);
      setInvites((current) => current.filter((entry) => entry.id !== invite.id));
      setResult({ kind: 'success', message: `Invitation to ${invite.email} revoked.` });
    } catch (error) {
      setResult({
        kind: 'error',
        message: messageFor(error, 'Could not revoke the invitation.'),
      });
    } finally {
      setBusyInvite(null);
    }
  };

  // The panel only mounts this for owners and admins; if a demotion leaves it
  // mounted for a moment, show nothing rather than a dead invite form.
  if (!canManageMembers(actorRole)) {
    return null;
  }

  const roleControl =
    allowedRoles.length > 1 ? (
      <AccessDropdown<WorkspaceRole>
        value={effectiveRole}
        options={roleOptions(actorRole)}
        onChange={setRole}
        ariaLabel="Invite role"
        align="left"
        muted
      />
    ) : (
      <span className="inline-flex select-none items-center px-2 py-1 text-[13px] font-medium text-muted-foreground/80">
        {workspaceRoleLabel(effectiveRole)}
      </span>
    );

  return (
    <>
      <SettingsSection
        title="Invite people"
        description={
          actorRole === 'OWNER'
            ? 'Send an email invitation. You can choose any role for the new member.'
            : 'Send an email invitation. Admins can invite members.'
        }
      >
        <form onSubmit={(event) => void handleInvite(event)} className="flex flex-col gap-2 py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              value={email}
              required
              placeholder="name@example.com"
              aria-label="Email address"
              onChange={(event) => {
                setEmail(event.target.value);
                setResult(null);
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {roleControl}
            <button
              type="submit"
              disabled={!email.trim() || isSending}
              className="inline-flex h-9 flex-shrink-0 items-center justify-center rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? 'Sending…' : 'Invite'}
            </button>
          </div>

          {result ? (
            <p
              role={result.kind === 'error' ? 'alert' : 'status'}
              className={`text-[12.5px] leading-snug ${
                result.kind === 'error'
                  ? 'text-destructive'
                  : result.kind === 'warning'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
              }`}
            >
              {result.message}
            </p>
          ) : null}
        </form>
      </SettingsSection>

      <SettingsSection
        title="Pending invites"
        description="Anyone who has not accepted yet. The invitation link is only sent by email."
      >
        <div className="py-3.5">
          {isLoadingInvites ? (
            <p className="text-[13px] text-muted-foreground">Loading invites…</p>
          ) : inviteError && invites.length === 0 ? (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-destructive">{inviteError}</p>
              <button
                type="button"
                onClick={retryInvites}
                className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-foreground/[0.06] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Try again
              </button>
            </div>
          ) : invites.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No pending invites.</p>
          ) : (
            <>
              <ul className="divide-y divide-border/60">
                {invites.map((invite) => {
                  const canManage = canGrantRole(actorRole, invite.role);
                  const expiry = formatExpiry(invite.expiresAt);
                  const isResending = busyInvite === `resend:${invite.id}`;
                  const isRevoking = busyInvite === `revoke:${invite.id}`;

                  return (
                    <li
                      key={invite.id}
                      className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium leading-snug">
                          {invite.email}
                        </p>
                        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground/70">
                          {workspaceRoleLabel(invite.role)}
                          {expiry ? ` · Expires ${expiry}` : ''}
                        </p>
                      </div>

                      {canManage ? (
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleResend(invite)}
                            disabled={busyInvite !== null}
                            className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isResending ? 'Sending…' : 'Resend'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRevoke(invite)}
                            disabled={busyInvite !== null}
                            className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRevoking ? 'Revoking…' : 'Revoke'}
                          </button>
                        </div>
                      ) : (
                        <span className="flex-shrink-0 text-[12px] text-muted-foreground/70">
                          Owner-managed
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {inviteError ? (
                <p role="alert" className="mt-2 text-[12.5px] text-destructive">
                  {inviteError}
                </p>
              ) : null}

              {!isLastPage ? (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  className="mt-2 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
