import { apiRequest } from '@/services/api-client';
import type { ApiComment, ApiThread, CommentAbilities } from '@/types/comment.types';

const DOCUMENTS_PATH = '/api/v1/documents';

/** Bearer header only when a session exists; guests ride the share link. */
function authHeaders(accessToken: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function documentPath(documentId: string): string {
  return `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}`;
}

function threadPath(documentId: string, threadId: string): string {
  return `${documentPath(documentId)}/threads/${encodeURIComponent(threadId)}`;
}

function commentPath(documentId: string, threadId: string, commentId: string): string {
  return `${threadPath(documentId, threadId)}/comments/${encodeURIComponent(commentId)}`;
}

function reactionPath(
  documentId: string,
  threadId: string,
  commentId: string,
  emoji: string
): string {
  return `${commentPath(documentId, threadId, commentId)}/reactions/${encodeURIComponent(emoji)}`;
}

/** A mutation that answers 204 with no envelope. */
async function requestMutation(
  path: string,
  accessToken: string | null,
  init: RequestInit = {}
): Promise<void> {
  await apiRequest<void>(
    path,
    { ...init, headers: { ...authHeaders(accessToken), ...init.headers } },
    { allowEmptyData: true }
  );
}

/**
 * Comment threads, replies, resolutions, and reactions against the Spring Boot API.
 *
 * Authentication is optional on purpose: one URL shape serves members and share-link
 * guests, and the server resolves a guest against the link's effective level. A guest
 * presenting a stale Bearer token fails closed, so callers must not send one.
 */
export const commentService = {
  list(documentId: string, accessToken: string | null, signal?: AbortSignal): Promise<ApiThread[]> {
    return apiRequest<ApiThread[]>(`${documentPath(documentId)}/threads`, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal,
    });
  },

  get(documentId: string, threadId: string, accessToken: string | null): Promise<ApiThread> {
    return apiRequest<ApiThread>(threadPath(documentId, threadId), {
      method: 'GET',
      headers: authHeaders(accessToken),
    });
  },

  createThread(documentId: string, accessToken: string | null, body: unknown): Promise<ApiThread> {
    return apiRequest<ApiThread>(`${documentPath(documentId)}/threads`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ body }),
    });
  },

  deleteThread(documentId: string, threadId: string, accessToken: string | null): Promise<void> {
    return requestMutation(threadPath(documentId, threadId), accessToken, { method: 'DELETE' });
  },

  resolveThread(documentId: string, threadId: string, accessToken: string | null): Promise<void> {
    return requestMutation(`${threadPath(documentId, threadId)}/resolve`, accessToken, {
      method: 'POST',
    });
  },

  unresolveThread(documentId: string, threadId: string, accessToken: string | null): Promise<void> {
    return requestMutation(`${threadPath(documentId, threadId)}/unresolve`, accessToken, {
      method: 'POST',
    });
  },

  addComment(
    documentId: string,
    threadId: string,
    accessToken: string | null,
    body: unknown
  ): Promise<ApiComment> {
    return apiRequest<ApiComment>(`${threadPath(documentId, threadId)}/comments`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ body }),
    });
  },

  updateComment(
    documentId: string,
    threadId: string,
    commentId: string,
    accessToken: string | null,
    body: unknown
  ): Promise<void> {
    return requestMutation(commentPath(documentId, threadId, commentId), accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  },

  deleteComment(
    documentId: string,
    threadId: string,
    commentId: string,
    accessToken: string | null
  ): Promise<void> {
    return requestMutation(commentPath(documentId, threadId, commentId), accessToken, {
      method: 'DELETE',
    });
  },

  addReaction(
    documentId: string,
    threadId: string,
    commentId: string,
    accessToken: string | null,
    emoji: string
  ): Promise<void> {
    return requestMutation(
      `${commentPath(documentId, threadId, commentId)}/reactions`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }
    );
  },

  removeReaction(
    documentId: string,
    threadId: string,
    commentId: string,
    accessToken: string | null,
    emoji: string
  ): Promise<void> {
    return requestMutation(reactionPath(documentId, threadId, commentId, emoji), accessToken, {
      method: 'DELETE',
    });
  },
};

export type { ApiComment, ApiThread, CommentAbilities };
