'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { NextDocs } from '@/icons';
import { authApiService } from '@/services/auth.service';
import { hardNavigate, hardReplace } from '@/lib/navigation.util';
import { safeRedirectPath } from '@/lib/safe-redirect.util';

interface LoginScreenProps {
  /** Raw `?next=` value; sanitized before any navigation. */
  next?: string | null;
}

export function LoginScreen({ next }: LoginScreenProps) {
  const requestedPath = safeRedirectPath(next);
  // A `?next=/login` target would bounce the post-refresh redirect back here.
  const nextPath = requestedPath.split(/[?#]/)[0] === '/login' ? '/' : requestedPath;
  const emailId = useId();
  const passwordId = useId();

  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refresh cookie can already belong to a signed-in user. Restore it before
  // showing the form so a bookmarked /login does not ask again. On a fresh
  // instance there is nobody to sign in as, so send the visitor to bootstrap.
  useEffect(() => {
    let cancelled = false;

    authApiService
      .refresh()
      .then(() => {
        if (!cancelled) {
          hardReplace(nextPath);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        authApiService
          .getInstanceStatus()
          .then(({ initialized }) => {
            if (cancelled) {
              return;
            }
            if (initialized) {
              setIsCheckingSession(false);
            } else {
              hardReplace('/join');
            }
          })
          // A failed probe must not block sign-in: the form still works when
          // the instance is initialized and the call was merely transient.
          .catch(() => {
            if (!cancelled) {
              setIsCheckingSession(false);
            }
          });
      });

    return () => {
      cancelled = true;
    };
  }, [nextPath]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await authApiService.login({ email, password });
      // A full navigation drops the previous identity's store and module
      // caches; the app then restores the new session from the refresh cookie.
      hardNavigate(nextPath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="nd-auth-shell">
      <div className="nd-auth-wordmark">
        <NextDocs className="h-[30px] w-[30px]" />
        <span className="nd-auth-wordmark-text">NextDocs</span>
      </div>

      <div className="nd-auth-card">
        <h1 className="nd-auth-title">Sign in</h1>
        <p className="nd-auth-subtitle">Welcome back. Enter your details to continue.</p>

        {isCheckingSession ? (
          <p className="nd-auth-loading" aria-live="polite">
            Checking your session…
          </p>
        ) : (
          <>
            {error && (
              <p className="nd-auth-error" role="alert">
                {error}
              </p>
            )}

            <form className="nd-auth-form" onSubmit={handleSubmit}>
              <div className="nd-auth-field">
                <label className="nd-auth-label" htmlFor={emailId}>
                  Email
                </label>
                <input
                  id={emailId}
                  className="nd-auth-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  autoFocus
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
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
              </div>

              <button className="nd-auth-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </>
        )}
      </div>

      <p className="nd-auth-footnote">Need access? Ask a workspace admin for an invite.</p>
    </main>
  );
}
