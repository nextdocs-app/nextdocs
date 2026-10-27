const REDIRECT_BASE = 'https://nextdocs.invalid';

/**
 * Accepts only same-origin relative paths for the `?next=` parameter. Anything
 * absolute, protocol-relative, backslash-normalized, or unparseable falls back
 * to the home route so a crafted link cannot bounce the user off-site.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return fallback;
  }

  try {
    const url = new URL(raw, REDIRECT_BASE);
    if (url.origin !== REDIRECT_BASE) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
