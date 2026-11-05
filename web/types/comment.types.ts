/**
 * Wire shapes for the comments API. Comment threads no longer live in the Y.Doc:
 * Spring Boot owns them, and the editor's BlockNote comment marks only reference a
 * thread id. Camel-case fields mirror the Java records; nullable fields arrive
 * omitted (the API drops nulls), so callers normalize with `?? null`.
 */

export interface CommentAuthor {
  id: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface CommentAbilities {
  update: boolean;
  delete: boolean;
  reactions: boolean;
}

export interface ThreadAbilities {
  delete: boolean;
  resolve: boolean;
  unresolve: boolean;
}

export interface ApiCommentReaction {
  emoji: string;
  createdAt: string;
  users: CommentAuthor[];
}

export interface ApiComment {
  id: string;
  author: CommentAuthor;
  /** BlockNote comment body: a JSON array of blocks. */
  body: unknown;
  createdAt: string;
  updatedAt: string;
  reactions: ApiCommentReaction[];
  abilities: CommentAbilities;
}

export interface ApiThread {
  id: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  resolvedUpdatedAt?: string | null;
  resolvedBy?: CommentAuthor | null;
  comments: ApiComment[];
  abilities: ThreadAbilities;
}
