import * as Y from '@y/y';
import { API_URL, MEMBER, OWNER } from './config';
import { clearMailpit, waitForInviteToken } from './mailpit';

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
}

export interface ApiAuth {
  accessToken: string;
  expiresIn: number;
  user: ApiUser;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  message: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.success || body.data == null) {
    throw new ApiError(
      body?.message ?? body?.error ?? `Request failed with ${response.status}`,
      response.status
    );
  }
  return body.data;
}

async function request<T>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (init.token) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return parseEnvelope<T>(response);
}

async function requestVoid(
  path: string,
  init: { method?: string; token?: string } = {}
): Promise<void> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.token) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    throw new ApiError(
      body?.message ?? body?.error ?? `Request failed with ${response.status}`,
      response.status
    );
  }
}

export async function register(
  account: { email: string; displayName: string; password: string },
  inviteToken?: string
): Promise<ApiAuth> {
  return request<ApiAuth>('/api/v1/auth/register', {
    method: 'POST',
    body: { ...account, ...(inviteToken ? { inviteToken } : {}) },
  });
}

export async function login(account: { email: string; password: string }): Promise<ApiAuth> {
  return request<ApiAuth>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
}

/**
 * Refreshing this early leaves enough of the token for a test and its teardown.
 * The E2E database outlives one run, so a cached session can be hours old.
 */
const SESSION_MIN_VALIDITY_MS = 60_000;

interface CachedSession {
  session: Promise<ApiAuth>;
  /** Absolute expiry once the login resolves; null while it is still in flight. */
  expiresAt: number | null;
}

/**
 * Memoizes one account's session for the run: log in once, and log in again only
 * when the token is about to expire. A failed lookup is dropped instead of being
 * inherited by every later caller.
 */
function createSessionCache(login: () => Promise<ApiAuth>): () => Promise<ApiAuth> {
  let cached: CachedSession | null = null;

  return () => {
    if (cached) {
      const remaining = cached.expiresAt === null ? Infinity : cached.expiresAt - Date.now();
      if (remaining > SESSION_MIN_VALIDITY_MS) {
        return cached.session;
      }
    }

    const entry: CachedSession = { session: login(), expiresAt: null };
    cached = entry;
    entry.session.then(
      (auth) => {
        entry.expiresAt = Date.now() + auth.expiresIn * 1000;
      },
      () => {
        if (cached === entry) {
          cached = null;
        }
      }
    );
    return entry.session;
  };
}

/**
 * The shared account's session, registered on a fresh database and logged in
 * otherwise. Every suite seeds through this one function.
 */
export const ensureOwnerSession = createSessionCache(loginOrRegisterOwner);

async function loginOrRegisterOwner(): Promise<ApiAuth> {
  try {
    return await login(OWNER);
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 400)) {
      throw error;
    }
    try {
      return await register(OWNER);
    } catch (registerError) {
      // Another worker (or a previous run) won the bootstrap race: log in again.
      if (registerError instanceof ApiError) {
        return login(OWNER);
      }
      throw registerError;
    }
  }
}

/** Grants document access to an existing account by email. */
export async function shareDocument(
  token: string,
  documentId: string,
  email: string,
  accessLevel: 'VIEW' | 'COMMENT' | 'EDIT'
): Promise<void> {
  await request(`/api/v1/documents/${encodeURIComponent(documentId)}/collaborators`, {
    method: 'POST',
    token,
    body: { email, accessLevel },
  });
}

/**
 * The second account's session: login, or invite + register through the real
 * workspace invite email on the first run against a fresh database.
 */
export const ensureMemberSession = createSessionCache(loginOrInviteMember);

async function loginOrInviteMember(): Promise<ApiAuth> {
  try {
    return await login(MEMBER);
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 400)) {
      throw error;
    }
  }

  const owner = await ensureOwnerSession();
  await clearMailpit();
  await request('/api/v1/workspaces/current/invites', {
    method: 'POST',
    token: owner.accessToken,
    body: { emails: [MEMBER.email], role: 'MEMBER' },
  });
  const inviteToken = await waitForInviteToken(MEMBER.email);
  return register(MEMBER, inviteToken);
}

/** Creates an empty document and returns its id. The caller owns cleanup. */
export async function createDocument(token: string, title: string): Promise<string> {
  const id = crypto.randomUUID();
  await request(`/api/v1/documents`, {
    method: 'POST',
    token,
    body: { id, title },
  });
  return id;
}

/**
 * The document's text as the room stores it: every string run of the base64 Yjs
 * update, joined in document order. The update cannot be searched as a string:
 * Yjs frames each run with a length prefix and splits runs where the editor's
 * transactions did, so the typed sentence is rarely one contiguous sequence.
 */
export async function readDocumentText(token: string, documentId: string): Promise<string> {
  const content = await request<{ content?: string | null }>(
    `/api/v1/documents/${encodeURIComponent(documentId)}/content`,
    { token }
  );
  if (!content.content) {
    return '';
  }

  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, Buffer.from(content.content, 'base64'));
    const parts: string[] = [];
    collectText(ydoc.get('blocknote'), parts);
    return parts.join('');
  } finally {
    ydoc.destroy();
  }
}

function collectText(node: Y.Node, out: string[]): void {
  for (const child of node.toArray()) {
    if (typeof child === 'string') {
      out.push(child);
    } else if (child instanceof Y.Node) {
      collectText(child, out);
    }
  }
}

/**
 * Deletes a document for good. The API only purges a document that is already in
 * the trash, so this is a soft delete followed by the permanent one.
 *
 * DELETE answers 204 with no body, which the envelope helpers used by the other
 * calls cannot parse; a failure here has to surface as an error instead of being
 * mistaken for an empty `data` field.
 */
export async function deleteDocument(token: string, id: string): Promise<void> {
  const path = `/api/v1/documents/${encodeURIComponent(id)}`;
  await requestVoid(path, { method: 'DELETE', token });
  await requestVoid(`${path}?permanent=true`, { method: 'DELETE', token });
}
