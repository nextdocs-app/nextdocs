'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Portal } from '@/components/Portal';
import { ChevronDown, Close, Users } from '@/icons';
import { trapTabKey } from '@/lib/focus-trap.util';
import { ApiError } from '@/services/api-client';
import { workspaceApiService } from '@/services/workspace.service';
import type { WorkspaceRole } from '@/types/auth.types';
import type { PeopleNotice } from './WorkspaceMemberList';
import {
  grantableRoles,
  WORKSPACE_ROLE_DESCRIPTIONS,
  WORKSPACE_ROLE_LABELS,
} from './workspace-role.util';

/** Mirrors WorkspaceInviteCreateRequest.MAX_EMAILS_PER_REQUEST on the server. */
const MAX_EMAILS_PER_INVITE = 20;

interface InviteMembersModalProps {
  isOpen: boolean;
  accessToken: string;
  actorRole: WorkspaceRole;
  onClose: () => void;
  /** A new invite exists; the caller refreshes whatever lists it shows. */
  onInvited: () => void;
  onNotice: (notice: PeopleNotice) => void;
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

function isEmailDeliveryMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function noInvitesMessage(alreadyMembers: string[], invalidEmails: string[]): string {
  if (alreadyMembers.length > 0 && invalidEmails.length === 0) {
    return alreadyMembers.length === 1
      ? `${alreadyMembers[0]} is already a member.`
      : `Already members: ${alreadyMembers.join(', ')}.`;
  }
  return 'No invitations could be sent. Please check the email addresses.';
}

/**
 * The invite dialog. Mounted only while open, so every visit starts from a clean
 * draft instead of resetting form state in an effect.
 */
export function InviteMembersModal({ isOpen, ...props }: InviteMembersModalProps) {
  return isOpen ? <InviteMembersDialog {...props} /> : null;
}

function InviteMembersDialog({
  accessToken,
  actorRole,
  onClose,
  onInvited,
  onNotice,
}: Omit<InviteMembersModalProps, 'isOpen'>) {
  const allowedRoles = useMemo(() => grantableRoles(actorRole), [actorRole]);
  const [emailsText, setEmailsText] = useState('');
  const [role, setRole] = useState<WorkspaceRole>(() =>
    allowedRoles.includes('MEMBER') ? 'MEMBER' : (allowedRoles[0] ?? 'MEMBER')
  );
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const roleFieldRef = useRef<HTMLDivElement>(null);
  const roleButtonRef = useRef<HTMLButtonElement>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // The parent closes over fresh state, so its callback changes identity on every
  // render. Keep the mount-only effect independent of that identity.
  const onCloseRef = useRef(onClose);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const emailsId = `${baseId}-emails`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // A widget inside the dialog already handled this key (the role menu
      // closes itself on Escape rather than dismissing the whole dialog).
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!isSubmittingRef.current) {
          onCloseRef.current();
        }
        return;
      }
      if (dialogRef.current) {
        trapTabKey(event, dialogRef.current);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!isRoleMenuOpen) {
      return;
    }

    roleMenuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!roleFieldRef.current?.contains(event.target as Node)) {
        setIsRoleMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isRoleMenuOpen]);

  const handleRoleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(
      roleMenuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []
    );
    if (options.length === 0) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsRoleMenuOpen(false);
      roleButtonRef.current?.focus();
      return;
    }

    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    let nextIndex = -1;
    if (event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options.length - 1;
    }

    if (nextIndex >= 0) {
      event.preventDefault();
      options[nextIndex]?.focus();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emails = parseEmails(emailsText);

    if (emails.length === 0) {
      setErrorText('Please enter at least one email address.');
      return;
    }
    if (emails.length > MAX_EMAILS_PER_INVITE) {
      setErrorText(
        `You can invite up to ${MAX_EMAILS_PER_INVITE} people at a time. Remove ${
          emails.length - MAX_EMAILS_PER_INVITE
        } to continue.`
      );
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);

    try {
      const results = await workspaceApiService.createInvites(accessToken, emails, role);
      const successfulEmails: string[] = [];
      const alreadyMemberEmails: string[] = [];
      const invalidEmails: string[] = [];

      for (const res of results) {
        if (res.status === 'INVITED' && res.invite) {
          successfulEmails.push(res.email);
        } else if (res.status === 'ALREADY_MEMBER') {
          alreadyMemberEmails.push(res.email);
        } else {
          invalidEmails.push(res.email);
        }
      }

      if (successfulEmails.length > 0) {
        onInvited();
      }

      if (
        successfulEmails.length > 0 &&
        alreadyMemberEmails.length === 0 &&
        invalidEmails.length === 0
      ) {
        onNotice({
          kind: 'status',
          message:
            successfulEmails.length === 1
              ? `Invitation sent to ${successfulEmails[0]}.`
              : `Sent ${successfulEmails.length} invitations.`,
        });
        onClose();
        return;
      }

      if (successfulEmails.length > 0) {
        const parts = [
          successfulEmails.length === 1
            ? 'Sent 1 invite.'
            : `Sent ${successfulEmails.length} invites.`,
        ];
        if (alreadyMemberEmails.length > 0) {
          parts.push(`Already a member: ${alreadyMemberEmails.join(', ')}.`);
        }
        if (invalidEmails.length > 0) {
          parts.push(`Invalid: ${invalidEmails.join(', ')}.`);
        }
        onNotice({ kind: 'status', message: parts.join(' ') });
        onClose();
        return;
      }

      setErrorText(noInvitesMessage(alreadyMemberEmails, invalidEmails));
    } catch (err: unknown) {
      setErrorText(
        isEmailDeliveryMissing(err)
          ? 'Email delivery is not configured on this instance.'
          : messageFor(err, 'Could not send invitations.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !isSubmitting) {
            onClose();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          tabIndex={-1}
          style={{ overscrollBehavior: 'contain' }}
          className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[480px] flex-col overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-2xl text-foreground animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Close size={16} />
          </button>

          <div className="flex flex-col items-center text-center">
            <span
              aria-hidden="true"
              className="mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <Users size={22} />
            </span>
            <h2 id={titleId} className="text-[18px] font-semibold tracking-tight leading-snug">
              Add members
            </h2>
            <p id={descId} className="mt-1 text-[13px] text-muted-foreground max-w-sm">
              Type or paste in emails below, separated by commas
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={emailsId} className="text-[12.5px] font-medium text-foreground/80">
                Email addresses
              </label>
              <input
                ref={inputRef}
                id={emailsId}
                type="text"
                value={emailsText}
                onChange={(e) => {
                  setEmailsText(e.target.value);
                  setErrorText(null);
                }}
                disabled={isSubmitting}
                placeholder="name@company.com, colleague@company.com"
                className="h-10 w-full rounded-md border border-border bg-transparent px-3 py-2 text-[13.5px] shadow-xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div ref={roleFieldRef} className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-foreground/80">Select role</span>
              <div className="relative">
                <button
                  ref={roleButtonRef}
                  type="button"
                  onClick={() => setIsRoleMenuOpen((prev) => !prev)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      setIsRoleMenuOpen(true);
                    }
                  }}
                  disabled={isSubmitting || allowedRoles.length <= 1}
                  aria-haspopup="listbox"
                  aria-expanded={isRoleMenuOpen}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-sidebar-accent/30 p-2.5 text-left transition-colors hover:bg-sidebar-accent/60 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="text-[13.5px] font-medium text-foreground">
                      {WORKSPACE_ROLE_LABELS[role]}
                    </div>
                    <div className="text-[12px] text-muted-foreground leading-snug">
                      {WORKSPACE_ROLE_DESCRIPTIONS[role]}
                    </div>
                  </div>
                  {allowedRoles.length > 1 && (
                    <ChevronDown
                      size={15}
                      className={`flex-shrink-0 text-muted-foreground transition-transform duration-150 ${
                        isRoleMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {isRoleMenuOpen && (
                  <div
                    ref={roleMenuRef}
                    role="listbox"
                    aria-label="Invite role"
                    onKeyDown={handleRoleMenuKeyDown}
                    className="absolute left-0 right-0 bottom-[calc(100%+4px)] z-20 flex flex-col rounded-lg border border-border bg-popover p-1 shadow-lg text-popover-foreground animate-in fade-in-0 zoom-in-95 duration-100"
                  >
                    {allowedRoles.map((r) => {
                      const isSelected = r === role;
                      return (
                        <button
                          key={r}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          onClick={() => {
                            setRole(r);
                            setIsRoleMenuOpen(false);
                            roleButtonRef.current?.focus();
                          }}
                          className={`flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-sidebar-accent font-medium text-foreground'
                              : 'hover:bg-sidebar-accent/50 text-foreground/90'
                          }`}
                        >
                          <span className="text-[13px] font-medium">
                            {WORKSPACE_ROLE_LABELS[r]}
                          </span>
                          <span className="text-[11.5px] text-muted-foreground leading-tight">
                            {WORKSPACE_ROLE_DESCRIPTIONS[r]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {errorText && (
              <p role="alert" className="text-[12.5px] font-medium text-destructive">
                {errorText}
              </p>
            )}

            <div className="mt-2 flex flex-col gap-2">
              <button
                type="submit"
                disabled={isSubmitting || parseEmails(emailsText).length === 0}
                className="flex h-9 w-full items-center justify-center rounded-md bg-[var(--nd-brand)] px-4 text-[13.5px] font-medium text-[var(--nd-brand-foreground)] shadow-xs transition-colors hover:bg-[var(--nd-brand-hover)] active:bg-[var(--nd-brand-active)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {isSubmitting ? 'Sending…' : 'Send invite'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex h-9 w-full items-center justify-center rounded-md border border-border bg-transparent px-4 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
