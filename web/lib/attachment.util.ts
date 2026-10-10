import type { DocumentAccessLevel } from '@/services/document.service';

/**
 * Blocks store this host-independent path (never an absolute or signed URL), so documents
 * remain portable across self-hosted deployments and no perishable capability ends up in
 * permanent Yjs history. The signed URL is derived at render time via `resolveFileUrl`.
 */
const STORED_ATTACHMENT_URL_PATTERN =
  /^\/api\/v1\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStoredAttachmentUrl(url: string): boolean {
  return STORED_ATTACHMENT_URL_PATTERN.test(url);
}

/** The suffix a signed download link adds to the stored path. */
const SIGNED_ATTACHMENT_FILE_SUFFIX = '/file';

/**
 * Normalizes any shape an attachment URL can arrive in - the bare stored path, a relative
 * signed `/file?exp&sig` link, or an absolute http(s) URL whose path is one of those - to
 * the host-independent stored path. Returns null when the URL is not an attachment URL, so
 * external embeds keep flowing through the http(s) allowlist untouched.
 */
export function canonicalStoredAttachmentUrl(url: string): string | null {
  if (!url) {
    return null;
  }

  let path = url;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  } else {
    path = path.split(/[?#]/, 1)[0];
  }
  // A pasted link may carry a trailing slash; without stripping it an attachment
  // path falls through to the unsupported-URL error instead of minting.
  path = path.replace(/\/+$/, '');

  if (isStoredAttachmentUrl(path)) {
    return path;
  }
  if (path.toLowerCase().endsWith(SIGNED_ATTACHMENT_FILE_SUFFIX)) {
    const base = path.slice(0, -SIGNED_ATTACHMENT_FILE_SUFFIX.length);
    if (isStoredAttachmentUrl(base)) {
      return base;
    }
  }
  return null;
}

export interface UploadEligibility {
  isAuthenticated: boolean;
  accessToken: string | null;
  isOnline: boolean;
  accessLevel: DocumentAccessLevel | null;
  deletedAt?: string | null;
}

export type UploadBlockReason = 'offline' | 'unauthenticated' | 'syncing' | 'read-only' | 'trashed';

/**
 * Explains why an upload cannot proceed, or `null` when it can. Uploads need a
 * signed-in session, a live connection, and EDIT access to a non-trashed document.
 */
export function describeUploadBlockReason({
  isAuthenticated,
  accessToken,
  isOnline,
  accessLevel,
  deletedAt,
}: UploadEligibility): UploadBlockReason | null {
  if (!isOnline) {
    return 'offline';
  }
  if (!isAuthenticated || !accessToken) {
    return 'unauthenticated';
  }
  if (deletedAt) {
    return 'trashed';
  }
  if (accessLevel == null) {
    // The access level is still loading; a null must not masquerade as "no permission".
    return 'syncing';
  }
  if (accessLevel !== 'EDIT' && accessLevel !== 'OWNER') {
    return 'read-only';
  }
  return null;
}
