export const INVITE_TOKEN_STORAGE_KEY = 'nextdocs.invite-token';

/**
 * Invitation tokens arrive in the URL fragment (`/join#token=...`) so they are
 * never sent to the server in a request line, reach a referrer, or land in a
 * proxy log. The page consumes the fragment and removes it immediately.
 */
export function readInviteToken(hash: string): string | null {
  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('token')?.trim();
  return token ? token : null;
}

/** Removes the fragment without adding a history entry or triggering navigation. */
export function stripUrlFragment(): void {
  if (typeof window === 'undefined' || !window.location.hash) {
    return;
  }

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

/**
 * Runs `access` against this tab's sessionStorage, or returns null when there is
 * none or it refuses to cooperate: blocked cookies and a full quota both throw,
 * and losing the stash costs a reload — never the sign-up.
 */
function withInviteTokenStorage<T>(access: (storage: Storage) => T): T | null {
  try {
    const storage = typeof window === 'undefined' ? null : window.sessionStorage;
    return storage ? access(storage) : null;
  } catch {
    return null;
  }
}

/**
 * Stashes the token the fragment carried for the life of this tab.
 *
 * Stripping the fragment leaves the invitee with no copy of their token, so a
 * reload of the join page — or any reload of the tab mid-signup — would drop
 * them on the invite-only card with no way forward. sessionStorage is scoped to
 * the tab, dies with it, and never leaves the browser.
 */
export function rememberInviteToken(token: string): void {
  withInviteTokenStorage((storage) => storage.setItem(INVITE_TOKEN_STORAGE_KEY, token));
}

export function readRememberedInviteToken(): string | null {
  const token = withInviteTokenStorage((storage) =>
    storage.getItem(INVITE_TOKEN_STORAGE_KEY)
  )?.trim();
  return token ? token : null;
}

/** Drops the stashed token once it has been spent, so it cannot outlive the sign-up. */
export function forgetInviteToken(): void {
  withInviteTokenStorage((storage) => storage.removeItem(INVITE_TOKEN_STORAGE_KEY));
}
