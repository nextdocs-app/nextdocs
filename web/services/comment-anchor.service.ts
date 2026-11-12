import { getRealtimeUrl } from '@/lib/api-url.util';
import { ApiError } from '@/services/api-client';
import type {
  AnchorCreateRequest,
  AnchorSelection,
} from '@/../../realtime/src/types/comment-anchor';

export type {
  AnchorSelection,
  RelativePositionJson,
} from '@/../../realtime/src/types/comment-anchor';

/**
 * Comment anchors are written through Yhub, not the REST API.
 *
 * Threads, replies and permissions belong to Spring Boot; the mark that ties a
 * thread to a passage lives in the Y.Doc. A COMMENT user is read-only on that
 * document, so these requests ask the realtime service to perform the one
 * trusted mutation: insert (or, after deletion, remove) the BlockNote comment
 * mark for an authorized thread id.
 */

/** `ws(s)://` becomes `http(s)://`; the anchor endpoint shares the Yhub origin. */
function realtimeHttpUrl(): string {
  return getRealtimeUrl().replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

function anchorUrl(documentId: string): string {
  return `${realtimeHttpUrl()}/api/anchor/v1/nextdocs/${encodeURIComponent(documentId)}`;
}

function authHeaders(accessToken: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function responseError(res: Response, action: string): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const message =
    typeof body?.error === 'string'
      ? body.error
      : `Failed to ${action} comment anchor (${res.status})`;
  return new ApiError(message, res.status);
}

export const ANCHOR_REQUEST_TIMEOUT_MS = 10_000;

export const commentAnchorService = {
  /**
   * `selection` is in Yjs relative-position form, so concurrent edits between
   * the browser's selection and the server's hydration cannot turn it into the
   * wrong passage. The server validates the thread and rejects a stale range.
   */
  async add(
    documentId: string,
    accessToken: string | null,
    threadId: string,
    selection: AnchorSelection
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANCHOR_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(anchorUrl(documentId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders(accessToken),
        },
        body: JSON.stringify({ threadId, selection } satisfies AnchorCreateRequest),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw await responseError(res, 'create');
      }
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Removal is only allowed by the realtime service after the comment API
   * reports the thread gone, so the caller cannot use it to strip a live mark.
   */
  async remove(documentId: string, accessToken: string | null, threadId: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANCHOR_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${anchorUrl(documentId)}?threadId=${encodeURIComponent(threadId)}`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          ...authHeaders(accessToken),
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw await responseError(res, 'remove');
      }
    } finally {
      clearTimeout(timeout);
    }
  },
};
