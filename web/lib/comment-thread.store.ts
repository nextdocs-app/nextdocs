import type { CommentData, ThreadData } from '@blocknote/core/comments';
import { ThreadStore, ThreadStoreAuth } from '@blocknote/core/comments';
import type { Awareness } from 'y-protocols/awareness';
import { ApiError } from '@/services/api-client';
import { commentService } from '@/services/comment.service';
import type {
  ApiComment,
  ApiCommentReaction,
  ApiThread,
  CommentAuthor,
  CommentAbilities,
  ThreadAbilities,
} from '@/types/comment.types';

/**
 * The user id BlockNote uses for share-link guests. The API reports a guest's
 * author as `null`; the client needs a stable string key so all guest comments
 * group under one "Guest" identity.
 */
export const ANONYMOUS_COMMENT_USER_ID = 'anonymous';

/** Awareness field broadcast after a comment mutation, so other tabs refresh. */
const COMMENT_PING_FIELD = 'nd-comments-ping';

export interface CommentProfile {
  displayName: string;
  avatarUrl: string | null;
}

export interface CommentPing {
  at: number;
  documentId: string;
  threadId?: string;
}

type CommentMetadata = {
  abilities: CommentAbilities;
  author: CommentAuthor;
};

type ThreadMetadata = {
  abilities: ThreadAbilities;
  resolvedBy: CommentAuthor | null;
};

function threadAbilitiesOf(thread: ThreadData): ThreadAbilities | undefined {
  return (thread.metadata as ThreadMetadata | undefined)?.abilities;
}

function commentAbilitiesOf(comment: CommentData): CommentAbilities | undefined {
  return (comment.metadata as CommentMetadata | undefined)?.abilities;
}

/**
 * ThreadStore backed by the comments API instead of the collaborative Y.Doc.
 *
 * Reads are synchronous by BlockNote's contract, so the store keeps a cache that a
 * REST fetch fills and every subscriber receives a fresh Map. Mutations go through
 * the API, which re-checks permissions and owns the timestamps; the local cache is
 * updated from the response (or refetched for 204-only mutations) so the UI never
 * shows a change the server refused.
 *
 * Cross-tab/real-time updates reuse the document's Yjs awareness channel: a ping
 * carries no comment content, only "this document's comments changed", and the
 * receiving clients refetch. That keeps awareness as the only thing comment users
 * write to the shared channel now that the Y.Doc is read-only for them.
 */
export class CommentThreadStore extends ThreadStore {
  /**
   * Deliberately unimplemented: BlockNote's default path writes the comment mark
   * into the Y.Doc, which is still the right home for the anchor. The store owns
   * the thread content only.
   */
  public addThreadToDocument?: ThreadStore['addThreadToDocument'];

  private threads = new Map<string, ThreadData>();
  private profiles = new Map<string, CommentProfile>();
  private subscribers = new Set<(threads: Map<string, ThreadData>) => void>();
  private lastPingByClient = new Map<number, number>();
  private lastPingSentAt = 0;
  private destroyed = false;
  private refreshPromise: Promise<void> | null = null;
  private queuedRefresh: Promise<void> | null = null;
  private mutationEpoch = 0;
  private readonly listAbort = new AbortController();

  constructor(
    private readonly documentId: string,
    private readonly options: {
      auth: ThreadStoreAuth;
      getAccessToken: () => string | null;
      awareness?: Awareness | null;
      /** Read access is COMMENT+; a VIEW mount keeps the store empty and silent. */
      canRead: () => boolean;
      onError?: (error: unknown) => void;
    }
  ) {
    super(options.auth);
    this.awareness = options.awareness ?? null;
    this.awareness?.on('update', this.onAwarenessUpdate);
    if (options.canRead()) {
      void this.refresh();
    }
  }

  private awareness: Awareness | null;

  /**
   * The awareness channel arrives after the document has loaded, so the store is
   * created first and told about it when it appears.
   */
  public setAwareness(awareness: Awareness | null): void {
    if (this.destroyed || this.awareness === awareness) {
      return;
    }
    this.awareness?.off('update', this.onAwarenessUpdate);
    this.awareness = awareness;
    this.awareness?.on('update', this.onAwarenessUpdate);
  }

  public destroy(): void {
    this.destroyed = true;
    this.listAbort.abort();
    this.awareness?.off('update', this.onAwarenessUpdate);
    this.subscribers.clear();
    this.lastPingByClient.clear();
  }

  /** Display profile recorded by the API, including deleted-author snapshots. */
  public getProfile(userId: string): CommentProfile | undefined {
    return this.profiles.get(userId);
  }

  public getThread(threadId: string): ThreadData {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }
    return thread;
  }

  public getThreads(): Map<string, ThreadData> {
    return this.threads;
  }

  public subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.subscribers.add(cb);
    if (!this.options.canRead()) {
      return () => {
        this.subscribers.delete(cb);
      };
    }

    // Asynchronous, like the Yjs store: BlockNote subscribes while the editor is
    // still initializing and must not be re-entered from its own constructor.
    const timer = setTimeout(() => {
      if (!this.destroyed && this.subscribers.has(cb)) {
        cb(this.getThreads());
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      this.subscribers.delete(cb);
    };
  }

  /** Loads or reloads every thread. Concurrent calls share one request. */
  public refresh(): Promise<void> {
    if (this.destroyed || !this.options.canRead()) {
      return Promise.resolve();
    }
    if (this.refreshPromise) {
      if (!this.queuedRefresh) {
        this.queuedRefresh = this.refreshPromise.then(() => {
          this.queuedRefresh = null;
          return this.refresh();
        });
      }
      return this.queuedRefresh;
    }

    this.refreshPromise = this.loadThreads().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async loadThreads(): Promise<void> {
    const startEpoch = this.mutationEpoch;
    try {
      const threads = await commentService.list(
        this.documentId,
        this.options.getAccessToken(),
        this.listAbort.signal
      );
      if (this.destroyed) {
        return;
      }
      if (startEpoch !== this.mutationEpoch) {
        // Discard stale list if local mutations occurred in-flight, then refetch.
        void this.refresh();
        return;
      }
      const next = new Map<string, ThreadData>();
      for (const thread of threads) {
        const mapped = this.toThreadData(thread);
        next.set(mapped.id, mapped);
      }
      this.threads = next;
      this.notify();
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      this.report(error);
    }
  }

  public async refreshThread(threadId: string): Promise<void> {
    if (this.destroyed || !this.options.canRead()) {
      return;
    }

    const startEpoch = this.mutationEpoch;
    try {
      const thread = await commentService.get(
        this.documentId,
        threadId,
        this.options.getAccessToken()
      );
      if (this.destroyed) {
        return;
      }
      if (startEpoch !== this.mutationEpoch) {
        // Discard stale response if local mutations occurred in-flight, then refetch.
        void this.refresh();
        return;
      }
      this.upsert(this.toThreadData(thread));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Deleted elsewhere (or this was the last comment), so drop the stale card.
        this.mutationEpoch++;
        if (this.threads.delete(threadId)) {
          this.notify();
        }
        return;
      }
      this.report(error);
    }
  }

  public createThread = async (options: {
    initialComment: { body: unknown; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> => {
    const thread = await commentService.createThread(
      this.documentId,
      this.options.getAccessToken(),
      options.initialComment.body
    );
    const mapped = this.toThreadData(thread);
    this.upsert(mapped);
    this.ping(mapped.id);
    return mapped;
  };

  public addComment = async (options: {
    comment: { body: unknown; metadata?: unknown };
    threadId: string;
  }): Promise<CommentData> => {
    const comment = await commentService.addComment(
      this.documentId,
      options.threadId,
      this.options.getAccessToken(),
      options.comment.body
    );
    const mapped = this.toCommentData(comment);
    const existing = this.threads.get(options.threadId);

    if (existing) {
      const index = existing.comments.findIndex((c) => c.id === mapped.id);
      const comments =
        index >= 0
          ? existing.comments.map((c, i) => (i === index ? mapped : c))
          : [...existing.comments, mapped];
      const updated: ThreadData = {
        ...existing,
        updatedAt: mapped.updatedAt,
        comments,
      };
      this.upsert(updated);
    } else {
      // The card was opened from a mark but the list has not loaded yet.
      await this.refreshThread(options.threadId);
    }
    this.ping(options.threadId);
    return mapped;
  };

  public updateComment = async (options: {
    comment: { body: unknown; metadata?: unknown };
    threadId: string;
    commentId: string;
  }): Promise<void> => {
    await commentService.updateComment(
      this.documentId,
      options.threadId,
      options.commentId,
      this.options.getAccessToken(),
      options.comment.body
    );
    // The server owns updatedAt and abilities, so take the fresh thread rather
    // than patching a timestamp locally.
    await this.refreshThread(options.threadId);
    this.ping(options.threadId);
  };

  public deleteComment = async (options: {
    threadId: string;
    commentId: string;
    softDelete?: boolean;
  }): Promise<void> => {
    await commentService.deleteComment(
      this.documentId,
      options.threadId,
      options.commentId,
      this.options.getAccessToken()
    );

    // Deleting the last comment deletes the thread server-side, and a concurrent
    // reply can keep it alive. Let the server's answer decide instead of guessing
    // from the local comment count; a 404 in refreshThread removes the card.
    await this.refreshThread(options.threadId);
    this.ping(options.threadId);
  };

  public deleteThread = async (options: { threadId: string }): Promise<void> => {
    await commentService.deleteThread(
      this.documentId,
      options.threadId,
      this.options.getAccessToken()
    );
    this.mutationEpoch++;
    if (this.threads.delete(options.threadId)) {
      this.notify();
    }
    this.ping(options.threadId);
  };

  public resolveThread = async (options: { threadId: string }): Promise<void> => {
    await commentService.resolveThread(
      this.documentId,
      options.threadId,
      this.options.getAccessToken()
    );
    await this.refreshThread(options.threadId);
    this.ping(options.threadId);
  };

  public unresolveThread = async (options: { threadId: string }): Promise<void> => {
    await commentService.unresolveThread(
      this.documentId,
      options.threadId,
      this.options.getAccessToken()
    );
    await this.refreshThread(options.threadId);
    this.ping(options.threadId);
  };

  public addReaction = async (options: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> => {
    await commentService.addReaction(
      this.documentId,
      options.threadId,
      options.commentId,
      this.options.getAccessToken(),
      options.emoji
    );
    await this.refreshThread(options.threadId);
    this.ping(options.threadId);
  };

  public deleteReaction = async (options: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> => {
    await commentService.removeReaction(
      this.documentId,
      options.threadId,
      options.commentId,
      this.options.getAccessToken(),
      options.emoji
    );
    await this.refreshThread(options.threadId);
    this.ping(options.threadId);
  };

  // --- awareness --------------------------------------------------------------

  private onAwarenessUpdate = ({ added, updated }: { added: number[]; updated: number[] }) => {
    const awareness = this.awareness;
    if (!awareness || this.destroyed) {
      return;
    }

    for (const clientId of [...added, ...updated]) {
      if (clientId === awareness.clientID) {
        continue;
      }

      const state = awareness.getStates().get(clientId) as
        Record<string, CommentPing | undefined> | undefined;
      const ping = state?.[COMMENT_PING_FIELD];
      const lastPingAt = this.lastPingByClient.get(clientId) ?? 0;
      if (!ping || ping.documentId !== this.documentId || ping.at <= lastPingAt) {
        continue;
      }

      this.lastPingByClient.set(clientId, ping.at);
      if (ping.threadId) {
        void this.refreshThread(ping.threadId);
      } else {
        void this.refresh();
      }
    }
  };

  private ping(threadId?: string): void {
    const awareness = this.awareness;
    if (!awareness) {
      return;
    }

    // Monotonic so two mutations in the same millisecond are not collapsed by the
    // receiver's `at <= lastPingAt` check.
    const at = Math.max(Date.now(), this.lastPingSentAt + 1);
    this.lastPingSentAt = at;
    awareness.setLocalStateField(COMMENT_PING_FIELD, {
      at,
      documentId: this.documentId,
      threadId,
    } satisfies CommentPing);
  }

  // --- cache ------------------------------------------------------------------

  private upsert(thread: ThreadData): void {
    this.mutationEpoch++;
    this.threads = new Map(this.threads);
    this.threads.set(thread.id, thread);
    this.notify();
  }

  private notify(): void {
    if (this.destroyed || this.subscribers.size === 0) {
      return;
    }
    const snapshot = new Map(this.threads);
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch (error) {
        console.error('Comment thread subscriber threw', error);
      }
    }
  }

  private report(error: unknown): void {
    if (this.options.onError) {
      this.options.onError(error);
      return;
    }
    console.error('Comment thread request failed', error);
  }

  // --- mapping ----------------------------------------------------------------

  private recordAuthor(author: CommentAuthor | null | undefined, fallbackId?: string): void {
    if (!author) {
      return;
    }
    const key = author.id ?? fallbackId ?? ANONYMOUS_COMMENT_USER_ID;
    this.profiles.set(key, {
      displayName: author.displayName,
      avatarUrl: author.avatarUrl ?? null,
    });
  }

  private toThreadData(thread: ApiThread): ThreadData {
    const resolverId =
      thread.resolvedBy?.id ?? (thread.resolvedBy ? `resolved:${thread.id}` : undefined);
    if (thread.resolvedBy) {
      this.recordAuthor(thread.resolvedBy, resolverId);
    }

    return {
      type: 'thread',
      id: thread.id,
      createdAt: new Date(thread.createdAt),
      updatedAt: new Date(thread.updatedAt),
      comments: thread.comments.map((comment) => this.toCommentData(comment)),
      resolved: thread.resolved,
      resolvedUpdatedAt: thread.resolvedUpdatedAt ? new Date(thread.resolvedUpdatedAt) : undefined,
      resolvedBy: resolverId,
      metadata: {
        abilities: thread.abilities,
        resolvedBy: thread.resolvedBy ?? null,
      } satisfies ThreadMetadata,
    };
  }

  private toCommentData(comment: ApiComment): CommentData {
    this.recordAuthor(comment.author);
    for (const reaction of comment.reactions) {
      for (const user of reaction.users) {
        this.recordAuthor(user);
      }
    }

    return {
      type: 'comment',
      id: comment.id,
      userId: comment.author?.id ?? ANONYMOUS_COMMENT_USER_ID,
      createdAt: new Date(comment.createdAt),
      updatedAt: new Date(comment.updatedAt),
      reactions: comment.reactions.map((reaction: ApiCommentReaction) => ({
        emoji: reaction.emoji,
        createdAt: new Date(reaction.createdAt),
        userIds: reaction.users.map((user) => user.id ?? ANONYMOUS_COMMENT_USER_ID),
      })),
      metadata: {
        abilities: comment.abilities,
        author: comment.author,
      } satisfies CommentMetadata,
      body: comment.body,
    } as CommentData;
  }
}

/**
 * ThreadStoreAuth driven by the abilities the API returns with each thread/comment.
 *
 * BlockNote's default auth only knows a role; the server also distinguishes "may
 * edit my own comment" from "may delete someone else's", and a share-link guest can
 * comment but cannot react. Reading the server's answer keeps the UI from offering
 * a control the API will reject.
 */
export class CommentThreadStoreAuth extends ThreadStoreAuth {
  constructor(
    private readonly currentUserId: () => string,
    private readonly canWrite: () => boolean,
    private readonly canCreate: () => boolean = canWrite
  ) {
    super();
  }

  canCreateThread(): boolean {
    return this.canCreate();
  }

  canAddComment(): boolean {
    return this.canWrite();
  }

  canUpdateComment(comment: CommentData): boolean {
    return commentAbilitiesOf(comment)?.update ?? false;
  }

  canDeleteComment(comment: CommentData): boolean {
    return commentAbilitiesOf(comment)?.delete ?? false;
  }

  canDeleteThread(thread: ThreadData): boolean {
    return threadAbilitiesOf(thread)?.delete ?? false;
  }

  canResolveThread(thread: ThreadData): boolean {
    return threadAbilitiesOf(thread)?.resolve ?? false;
  }

  canUnresolveThread(thread: ThreadData): boolean {
    return threadAbilitiesOf(thread)?.unresolve ?? false;
  }

  canAddReaction(comment: CommentData, emoji?: string): boolean {
    if (!commentAbilitiesOf(comment)?.reactions) {
      return false;
    }
    if (!emoji) {
      return true;
    }
    return !this.hasReacted(comment, emoji);
  }

  canDeleteReaction(comment: CommentData, emoji?: string): boolean {
    if (!commentAbilitiesOf(comment)?.reactions) {
      return false;
    }
    if (!emoji) {
      return true;
    }
    return this.hasReacted(comment, emoji);
  }

  private hasReacted(comment: CommentData, emoji: string): boolean {
    const me = this.currentUserId();
    if (!me || me === ANONYMOUS_COMMENT_USER_ID) {
      return false;
    }
    return comment.reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.userIds.includes(me)
    );
  }
}
