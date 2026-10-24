'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { NextDocs } from '@/icons';
import { authApiService } from '@/services/auth.service';
import { hardNavigate } from '@/lib/navigation.util';
import {
  forgetInviteToken,
  readInviteToken,
  readRememberedInviteToken,
  rememberInviteToken,
  stripUrlFragment,
} from '@/lib/invite-token.util';
import type { InvitePreview } from '@/types/auth.types';

type JoinPhase =
  | { kind: 'reading' }
  | { kind: 'missing' }
  | { kind: 'bootstrap' }
  | { kind: 'previewing' }
  | { kind: 'ready'; preview: InvitePreview; token: string }
  | { kind: 'invalid'; message: string };

const ROLE_LABELS: Record<InvitePreview['role'], string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Public invite acceptance page. Redux-free and outside the app shell: the
 * invitee has no session yet, and the register call sets the refresh cookie
 * that the workspace boots from after a full navigation.
 *
 * On a fresh instance the same route bootstraps the first account, because
 * nobody exists yet who could have issued an invite.
 */
export function JoinScreen() {
  const [phase, setPhase] = useState<JoinPhase>({ kind: 'reading' });
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const emailId = useId();
  const displayNameId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();

  // The fragment is the only copy of the token in the URL, so read it before
  // the effect strips it, and stash it so a reload of this tab can still finish
  // the sign-up. A ref keeps the value across effect re-runs while still
  // rendering the same "reading" card on the server and the first client pass.
  const tokenRef = useRef<string | null | undefined>(undefined);
  // An invite link pasted into the tab that is already showing this page only
  // changes the fragment — the page never re-mounts — so the read has to be
  // driven by the fragment arriving as well as by the first mount.
  const [fragmentRevision, setFragmentRevision] = useState(0);

  useEffect(() => {
    const handleHashChange = () => {
      if (readInviteToken(window.location.hash)) {
        setFragmentRevision((revision) => revision + 1);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const fromFragment = readInviteToken(window.location.hash);
    if (fromFragment) {
      // Remember before stripping: the fragment is the only copy of the token.
      rememberInviteToken(fromFragment);
      tokenRef.current = fromFragment;
    } else if (tokenRef.current === undefined) {
      tokenRef.current = readRememberedInviteToken();
    }
    stripUrlFragment();

    const token = tokenRef.current;
    if (!token) {
      let cancelled = false;

      // Only an uninitialized instance has a first account to create. A failed
      // probe stays on the invite-only card: someone holding a link still has a
      // working path, and showing the bootstrap form by mistake would just fail
      // on submit.
      authApiService
        .getInstanceStatus()
        .then(({ initialized }) => {
          if (!cancelled) {
            setPhase(initialized ? { kind: 'missing' } : { kind: 'bootstrap' });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPhase({ kind: 'missing' });
          }
        });

      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    setPhase({ kind: 'previewing' });

    authApiService
      .previewInvite(token)
      .then((preview) => {
        if (!cancelled) {
          setPhase({ kind: 'ready', preview, token });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPhase({
            kind: 'invalid',
            message:
              error instanceof Error
                ? error.message
                : 'This invitation link is invalid or has expired.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fragmentRevision]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((phase.kind !== 'ready' && phase.kind !== 'bootstrap') || isSubmitting) {
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await authApiService.register(
        phase.kind === 'ready'
          ? {
              email: phase.preview.email,
              displayName,
              password,
              inviteToken: phase.token,
            }
          : { email, displayName, password }
      );
      // The token has been spent and the account exists, so nothing may retry
      // the registration with it after this tab navigates away.
      forgetInviteToken();
      // A full load boots the app with the new refresh cookie and none of the
      // guest/preview module state.
      hardNavigate('/');
    } catch (error: unknown) {
      setFormError(
        error instanceof Error ? error.message : 'Unable to create your account. Please try again.'
      );
      setIsSubmitting(false);
    }
  }

  function renderCredentialsForm(lockedEmail: string | null) {
    return (
      <form className="nd-auth-form" onSubmit={handleSubmit}>
        <div className="nd-auth-field">
          <label className="nd-auth-label" htmlFor={emailId}>
            Email
          </label>
          <input
            id={emailId}
            className="nd-auth-input"
            type="email"
            value={lockedEmail ?? email}
            onChange={lockedEmail === null ? (event) => setEmail(event.target.value) : undefined}
            readOnly={lockedEmail !== null}
            aria-readonly={lockedEmail !== null || undefined}
            autoComplete={lockedEmail === null ? 'email' : undefined}
            placeholder={lockedEmail === null ? 'you@example.com' : undefined}
            required
            autoFocus={lockedEmail === null}
          />
          {lockedEmail !== null && (
            <p className="nd-auth-field-hint">This invitation is tied to this address.</p>
          )}
        </div>

        <div className="nd-auth-field">
          <label className="nd-auth-label" htmlFor={displayNameId}>
            Full name
          </label>
          <input
            id={displayNameId}
            className="nd-auth-input"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
            autoFocus={lockedEmail !== null}
          />
        </div>

        <div className="nd-auth-field">
          <label className="nd-auth-label" htmlFor={passwordId}>
            Password
          </label>
          <input
            id={passwordId}
            className="nd-auth-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        <div className="nd-auth-field">
          <label className="nd-auth-label" htmlFor={confirmPasswordId}>
            Confirm password
          </label>
          <input
            id={confirmPasswordId}
            className="nd-auth-input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        <button className="nd-auth-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    );
  }

  function renderCard() {
    if (phase.kind === 'reading' || phase.kind === 'previewing') {
      return (
        <div className="nd-auth-card">
          <h1 className="nd-auth-title">Join NextDocs</h1>
          <p className="nd-auth-loading" aria-live="polite">
            Checking this workspace…
          </p>
        </div>
      );
    }

    if (phase.kind === 'missing') {
      return (
        <div className="nd-auth-card">
          <h1 className="nd-auth-title">An invitation is required</h1>
          <p className="nd-auth-subtitle">
            NextDocs workspaces are invite-only. Ask a workspace admin for an invite link, or sign
            in if you already have an account.
          </p>
          <div className="nd-auth-card-actions">
            <a className="nd-auth-button" href="/login">
              Sign in
            </a>
          </div>
        </div>
      );
    }

    if (phase.kind === 'invalid') {
      return (
        <div className="nd-auth-card">
          <h1 className="nd-auth-title">Invitation unavailable</h1>
          <p className="nd-auth-error" role="alert">
            {phase.message}
          </p>
          <p className="nd-auth-subtitle">
            Ask an admin to resend the invite, or sign in if you already have an account.
          </p>
          <div className="nd-auth-card-actions">
            <a className="nd-auth-link" href="/login">
              Go to sign in
            </a>
          </div>
        </div>
      );
    }

    if (phase.kind === 'bootstrap') {
      return (
        <div className="nd-auth-card">
          <h1 className="nd-auth-title">Set up this instance</h1>
          <p className="nd-auth-subtitle">
            This instance has no workspace yet. Create the first account to own it; everyone else
            joins by invitation.
          </p>

          {formError && (
            <p className="nd-auth-error" role="alert">
              {formError}
            </p>
          )}

          {renderCredentialsForm(null)}
        </div>
      );
    }

    const { preview } = phase;

    return (
      <div className="nd-auth-card">
        <h1 className="nd-auth-title">Join {preview.workspaceName}</h1>
        <p className="nd-auth-subtitle">
          You&apos;ve been invited to this workspace. Set up your account to accept.
        </p>

        <dl className="nd-auth-invite">
          <div className="nd-auth-invite-row">
            <dt className="nd-auth-invite-label">Role</dt>
            <dd className="nd-auth-invite-value">{ROLE_LABELS[preview.role]}</dd>
          </div>
          <div className="nd-auth-invite-row">
            <dt className="nd-auth-invite-label">Invite expires</dt>
            <dd className="nd-auth-invite-value">
              <time dateTime={preview.expiresAt}>{formatExpiry(preview.expiresAt)}</time>
            </dd>
          </div>
        </dl>

        {formError && (
          <p className="nd-auth-error" role="alert">
            {formError}
          </p>
        )}

        {renderCredentialsForm(preview.email)}
      </div>
    );
  }

  return (
    <main className="nd-auth-shell">
      <div className="nd-auth-wordmark">
        <NextDocs className="h-[30px] w-[30px]" />
        <span className="nd-auth-wordmark-text">NextDocs</span>
      </div>

      {renderCard()}

      {phase.kind !== 'bootstrap' && (
        <p className="nd-auth-footnote">
          Already have an account?{' '}
          <a className="nd-auth-link" href="/login">
            Sign in
          </a>
        </p>
      )}
    </main>
  );
}
