'use client';

import { useEffect } from 'react';
import { NextDocs } from '@/icons';
import { authApiService } from '@/services/auth.service';
import { hardReplace } from '@/lib/navigation.util';
import { useAuth } from '@/hooks/useAuth.hook';

/**
 * The signed-out face of the root route. Guests never mount the document shell,
 * so the first visit goes straight to the lightweight auth surface instead of
 * an empty editor with a sign-in card.
 *
 * `isInitializing` stays true until the refresh-token probe settles; until then
 * the splash is the only thing shown, which is also what the server rendered.
 */
export function WorkspaceEntry() {
  const { isAuthenticated, isInitializing } = useAuth();

  useEffect(() => {
    if (isAuthenticated || isInitializing) {
      return;
    }

    let cancelled = false;

    // A fresh instance has no account to sign in with, so it bootstraps at
    // /join. A failed probe falls back to /login, which repeats the check.
    authApiService
      .getInstanceStatus()
      .then(({ initialized }) => {
        if (!cancelled) {
          hardReplace(initialized ? '/login' : '/join');
        }
      })
      .catch(() => {
        if (!cancelled) {
          hardReplace('/login');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isInitializing]);

  return (
    <div className="flex h-dvh items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <NextDocs className="h-9 w-9" />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Loading your workspace…
        </p>
      </div>
    </div>
  );
}
