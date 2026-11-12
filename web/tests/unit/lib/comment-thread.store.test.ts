import type { CommentData, ThreadData } from '@blocknote/core/comments';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { absolutePositionToRelativePosition, ySyncPluginKey } from 'y-prosemirror';
import { ApiError } from '../../../services/api-client';
import { commentAnchorService } from '../../../services/comment-anchor.service';
import { commentService } from '../../../services/comment.service';
import {
  ANONYMOUS_COMMENT_USER_ID,
  CommentThreadStore,
  CommentThreadStoreAuth,
} from '../../../lib/comment-thread.store';
import type { ApiComment, ApiThread } from '../../../types/comment.types';

jest.mock('../../../services/comment-anchor.service', () => ({
  commentAnchorService: {
    add: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('../../../services/comment.service', () => ({
  commentService: {
    list: jest.fn(),
    get: jest.fn(),
    createThread: jest.fn(),
    deleteThread: jest.fn(),
    resolveThread: jest.fn(),
    unresolveThread: jest.fn(),
    addComment: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
    addReaction: jest.fn(),
    removeReaction: jest.fn(),
  },
}));

jest.mock('y-prosemirror', () => ({
  absolutePositionToRelativePosition: jest.fn(),
  ySyncPluginKey: { getState: jest.fn() },
}));

const service = commentService as jest.Mocked<typeof commentService>;
const anchorService = commentAnchorService as jest.Mocked<typeof commentAnchorService>;

function abilities(overrides: Partial<ApiComment['abilities']> = {}) {
  return { update: false, delete: false, reactions: true, ...overrides };
}

function apiComment(overrides: Partial<ApiComment> = {}): ApiComment {
  return {
    id: 'comment-1',
    author: { id: 'user-1', displayName: 'Ada', avatarUrl: null },
    body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    reactions: [],
    abilities: abilities(),
    ...overrides,
  };
}

function apiThread(overrides: Partial<ApiThread> = {}): ApiThread {
  return {
    id: 'thread-1',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:05:00.000Z',
    resolved: false,
    comments: [apiComment()],
    abilities: { delete: true, resolve: true, unresolve: false },
    ...overrides,
  };
}

type AwarenessListener = (payload: { added: number[]; updated: number[] }) => void;

/**
 * A hand-driven awareness channel: the real one only delivers a peer's field when a
 * provider forwards the update, which the store never sees in a unit test.
 */
function fakeAwareness(remoteClientId: number, remoteState: Record<string, unknown>) {
  const listeners = new Set<AwarenessListener>();
  const states = new Map<number, Record<string, unknown>>([[remoteClientId, remoteState]]);
  const awareness = {
    clientID: 1,
    on: (_event: string, listener: AwarenessListener) => listeners.add(listener),
    off: (_event: string, listener: AwarenessListener) => listeners.delete(listener),
    getStates: () => states,
    setLocalStateField: jest.fn(),
  } as unknown as Awareness;

  return {
    awareness,
    setRemoteState: (clientId: number, state: Record<string, unknown>) => {
      states.set(clientId, state);
    },
    broadcast: (clientId = remoteClientId) =>
      listeners.forEach((listener) => listener({ added: [clientId], updated: [] })),
  };
}

function createStore(
  options: {
    canRead?: boolean | (() => boolean);
    awareness?: Awareness | null;
    onError?: (error: unknown) => void;
    onAnchorError?: (error: unknown) => void;
  } = {}
) {
  const canReadOption = options.canRead;
  const canReadFn: () => boolean =
    typeof canReadOption === 'function' ? canReadOption : () => canReadOption ?? true;
  const auth = new CommentThreadStoreAuth(() => 'user-1', canReadFn);
  const store = new CommentThreadStore('doc-1', {
    auth,
    getAccessToken: () => 'token-1',
    awareness: options.awareness ?? null,
    canRead: canReadFn,
    onError: options.onError,
    onAnchorError: options.onAnchorError,
  });
  return { store, auth };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function blockNoteComment(
  options: { reactions?: CommentData['reactions']; metadata?: unknown } = {}
): CommentData {
  return {
    type: 'comment',
    id: 'comment-1',
    userId: 'user-1',
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T10:00:00.000Z'),
    reactions: options.reactions ?? [],
    metadata: options.metadata ?? {},
    body: [],
  };
}

describe('CommentThreadStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (absolutePositionToRelativePosition as jest.Mock).mockReset();
    (ySyncPluginKey.getState as jest.Mock).mockReset();
    anchorService.add.mockResolvedValue(undefined);
    anchorService.remove.mockResolvedValue(undefined);
  });

  it('maps an API thread into BlockNote thread and comment data', async () => {
    service.list.mockResolvedValue([
      apiThread({
        resolved: true,
        resolvedUpdatedAt: '2026-01-01T11:00:00.000Z',
        resolvedBy: { id: 'user-2', displayName: 'Grace', avatarUrl: 'https://avatar/2' },
        comments: [
          apiComment(),
          apiComment({
            id: 'comment-2',
            author: { id: null, displayName: 'Guest', avatarUrl: null },
            reactions: [
              {
                emoji: '👍',
                createdAt: '2026-01-01T10:30:00.000Z',
                users: [
                  { id: 'user-1', displayName: 'Ada', avatarUrl: null },
                  { id: null, displayName: 'Guest', avatarUrl: null },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    const { store } = createStore();
    await store.refresh();

    const thread = store.getThread('thread-1');
    expect(thread.resolved).toBe(true);
    expect(thread.resolvedBy).toBe('user-2');
    expect(thread.comments).toHaveLength(2);
    expect(thread.comments[1].userId).toBe(ANONYMOUS_COMMENT_USER_ID);
    expect(thread.comments[1].reactions[0].userIds).toEqual(['user-1', ANONYMOUS_COMMENT_USER_ID]);
    expect(thread.updatedAt).toEqual(new Date('2026-01-01T10:05:00.000Z'));

    // Author snapshots come from the API so a deleted account still renders.
    expect(store.getProfile('user-1')).toEqual({ displayName: 'Ada', avatarUrl: null });
    expect(store.getProfile(ANONYMOUS_COMMENT_USER_ID)).toEqual({
      displayName: 'Guest',
      avatarUrl: null,
    });
    expect(store.getProfile('user-2')).toEqual({
      displayName: 'Grace',
      avatarUrl: 'https://avatar/2',
    });
  });

  it('loads nothing and notifies no one for a caller without comment access', async () => {
    const { store } = createStore({ canRead: false });
    const subscriber = jest.fn();

    const unsubscribe = store.subscribe(subscriber);
    await store.refresh();
    await settled();

    expect(service.list).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
    unsubscribe();
    store.destroy();
  });

  it('notifies subscribers with a fresh snapshot after a load', async () => {
    service.list.mockResolvedValue([apiThread()]);
    const { store } = createStore();
    const subscriber = jest.fn();
    store.subscribe(subscriber);
    await settled();

    await store.refresh();
    await settled();

    expect(subscriber).toHaveBeenCalled();
    const snapshot = subscriber.mock.calls.at(-1)?.[0] as Map<string, unknown>;
    expect(snapshot.has('thread-1')).toBe(true);
  });

  it('creates a thread through the API without writing the Y.Doc', async () => {
    service.list.mockResolvedValue([]);
    service.createThread.mockResolvedValue(apiThread());
    const { store } = createStore();

    const created = await store.createThread({
      initialComment: { body: [{ type: 'paragraph', content: [] }] },
    });

    expect(service.createThread).toHaveBeenCalledWith('doc-1', 'token-1', [
      { type: 'paragraph', content: [] },
    ]);
    expect(created.id).toBe('thread-1');
    expect(store.getThreads().has('thread-1')).toBe(true);
  });

  it('deletes a thread locally only after the API accepts it', async () => {
    service.list.mockResolvedValue([apiThread()]);
    service.deleteThread.mockRejectedValue(new ApiError('Forbidden', 403));
    const { store } = createStore();
    await store.refresh();

    await expect(store.deleteThread({ threadId: 'thread-1' })).rejects.toThrow('Forbidden');
    expect(store.getThreads().has('thread-1')).toBe(true);
  });

  it('drops a thread when deleting its last comment removes it server-side', async () => {
    service.list.mockResolvedValue([apiThread()]);
    service.deleteComment.mockResolvedValue(undefined);
    service.get.mockRejectedValue(new ApiError('Not found', 404));
    const { store } = createStore();
    await store.refresh();

    await store.deleteComment({ threadId: 'thread-1', commentId: 'comment-1' });

    expect(service.get).toHaveBeenCalledWith('doc-1', 'thread-1', 'token-1');
    expect(store.getThreads().has('thread-1')).toBe(false);
    expect(anchorService.remove).toHaveBeenCalledWith('doc-1', 'token-1', 'thread-1');
  });

  it('discards a stale thread refresh if a mutation happened in flight', async () => {
    service.list.mockResolvedValue([apiThread({ id: 'thread-1' })]);
    let resolveGet!: (value: ApiThread) => void;
    service.get.mockReturnValue(
      new Promise<ApiThread>((res) => {
        resolveGet = res;
      })
    );
    service.deleteThread.mockResolvedValue(undefined);

    const { store } = createStore();
    await store.refresh();

    const refreshPromise = store.refreshThread('thread-1');
    await store.deleteThread({ threadId: 'thread-1' });
    expect(store.getThreads().has('thread-1')).toBe(false);
    expect(anchorService.remove).toHaveBeenCalledWith('doc-1', 'token-1', 'thread-1');

    service.list.mockResolvedValue([]);
    resolveGet(apiThread({ id: 'thread-1' }));
    await refreshPromise;
    await settled();

    expect(store.getThreads().has('thread-1')).toBe(false);
  });

  it('serializes the editor selection into relative positions for the anchor request', async () => {
    const relativeDoc = new Y.Doc();
    const text = relativeDoc.getText('anchor');
    text.insert(0, 'hello world');
    const anchor = Y.createRelativePositionFromTypeIndex(text, 1);
    const head = Y.createRelativePositionFromTypeIndex(text, 4);
    const binding = { type: {}, mapping: {} };
    (absolutePositionToRelativePosition as jest.Mock)
      .mockReturnValueOnce(anchor)
      .mockReturnValueOnce(head);
    (ySyncPluginKey.getState as jest.Mock).mockReturnValue({ binding });
    const { store } = createStore();

    await store.addThreadToDocument({
      threadId: 'thread-1',
      selection: { anchor: 1, head: 4 },
      editor: { prosemirrorState: {} } as never,
    });

    expect(absolutePositionToRelativePosition).toHaveBeenNthCalledWith(
      1,
      1,
      binding.type,
      binding.mapping
    );
    expect(absolutePositionToRelativePosition).toHaveBeenNthCalledWith(
      2,
      4,
      binding.type,
      binding.mapping
    );
    expect(anchorService.add).toHaveBeenCalledWith('doc-1', 'token-1', 'thread-1', {
      anchor: Y.relativePositionToJSON(anchor),
      head: Y.relativePositionToJSON(head),
    });
  });

  it('reports an unavailable anchor binding without failing thread creation', async () => {
    const onError = jest.fn();
    const onAnchorError = jest.fn();
    const { store } = createStore({ onError, onAnchorError });

    await expect(
      store.addThreadToDocument({
        threadId: 'thread-1',
        selection: { anchor: 0, head: 5 },
        editor: { prosemirrorState: {} } as never,
      })
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onAnchorError).toHaveBeenCalledWith(expect.any(Error));
    store.destroy();
  });

  it('reports a rejected anchor request without failing thread creation', async () => {
    const relativeDoc = new Y.Doc();
    const text = relativeDoc.getText('anchor');
    text.insert(0, 'hello world');
    (absolutePositionToRelativePosition as jest.Mock)
      .mockReturnValueOnce(Y.createRelativePositionFromTypeIndex(text, 0))
      .mockReturnValueOnce(Y.createRelativePositionFromTypeIndex(text, 5));
    (ySyncPluginKey.getState as jest.Mock).mockReturnValue({
      binding: { type: {}, mapping: {} },
    });
    const error = new ApiError('Anchor service down', 503);
    anchorService.add.mockRejectedValue(error);
    const onError = jest.fn();
    const onAnchorError = jest.fn();
    const { store } = createStore({ onError, onAnchorError });

    await expect(
      store.addThreadToDocument({
        threadId: 'thread-1',
        selection: { anchor: 0, head: 5 },
        editor: { prosemirrorState: {} } as never,
      })
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(error);
    expect(onAnchorError).toHaveBeenCalledWith(error);
    store.destroy();
  });

  it('replaces matching comment in place if already present in addComment', async () => {
    const initialThread = apiThread({
      id: 'thread-1',
      comments: [apiComment({ id: 'comment-1', createdAt: '2026-01-01T10:00:00.000Z' })],
    });
    service.list.mockResolvedValue([initialThread]);
    const updatedComment = apiComment({
      id: 'comment-1',
      updatedAt: '2026-01-01T10:10:00.000Z',
    });
    service.addComment.mockResolvedValue(updatedComment);
    const { store } = createStore();
    await store.refresh();

    await store.addComment({
      threadId: 'thread-1',
      comment: { body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
    });

    const thread = store.getThread('thread-1');
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].updatedAt.toISOString()).toBe('2026-01-01T10:10:00.000Z');
  });

  it('removes a thread whose refresh answers 404', async () => {
    service.list.mockResolvedValue([apiThread()]);
    service.get.mockRejectedValue(new ApiError('Not found', 404));
    const { store } = createStore();
    await store.refresh();

    await store.refreshThread('thread-1');

    expect(store.getThreads().has('thread-1')).toBe(false);
  });

  it('refetches a thread after a mutation that answers 204', async () => {
    service.list.mockResolvedValue([apiThread()]);
    service.resolveThread.mockResolvedValue(undefined);
    service.get.mockResolvedValue(apiThread({ resolved: true }));
    const { store } = createStore();
    await store.refresh();

    await store.resolveThread({ threadId: 'thread-1' });

    expect(store.getThread('thread-1').resolved).toBe(true);
  });

  it('refetches when a peer broadcasts a comment change over awareness', async () => {
    const { awareness, broadcast } = fakeAwareness(2, {
      'nd-comments-ping': { at: Date.now(), documentId: 'doc-1', threadId: 'thread-1' },
    });
    service.list.mockResolvedValue([apiThread()]);
    service.get.mockResolvedValue(apiThread());
    const { store } = createStore({ awareness });

    await store.refresh();
    broadcast();
    await settled();

    expect(service.get).toHaveBeenCalledWith('doc-1', 'thread-1', 'token-1');
    store.destroy();
  });

  it('ignores pings for another document', async () => {
    const { awareness, broadcast } = fakeAwareness(2, {
      'nd-comments-ping': { at: Date.now(), documentId: 'other-doc' },
    });
    service.list.mockResolvedValue([apiThread()]);
    const { store } = createStore({ awareness });
    await store.refresh();

    broadcast();
    await settled();

    expect(service.get).not.toHaveBeenCalled();
    store.destroy();
  });

  it('emits awareness pings on mutation and handles null awareness', async () => {
    const { awareness } = fakeAwareness(2, {});
    service.createThread.mockResolvedValue(apiThread({ id: 'thread-created' }));
    const { store } = createStore({ awareness });

    await store.createThread({ initialComment: { body: [] } });

    expect(awareness.setLocalStateField).toHaveBeenCalledWith('nd-comments-ping', {
      at: expect.any(Number),
      documentId: 'doc-1',
      threadId: 'thread-created',
    });

    const { store: noAwarenessStore } = createStore({ awareness: null });
    await expect(
      noAwarenessStore.createThread({ initialComment: { body: [] } })
    ).resolves.toBeDefined();
    noAwarenessStore.destroy();
    store.destroy();
  });

  it('handles multi-client awareness pings without clock skew suppression', async () => {
    const { awareness, setRemoteState, broadcast } = fakeAwareness(2, {
      'nd-comments-ping': { at: 2000, documentId: 'doc-1', threadId: 'thread-from-peer-2' },
    });
    setRemoteState(3, {
      'nd-comments-ping': { at: 1000, documentId: 'doc-1', threadId: 'thread-from-peer-3' },
    });
    service.list.mockResolvedValue([apiThread()]);
    service.get.mockResolvedValue(apiThread());
    const { store } = createStore({ awareness });
    await store.refresh();

    broadcast(2);
    await settled();
    expect(service.get).toHaveBeenCalledWith('doc-1', 'thread-from-peer-2', 'token-1');

    broadcast(3);
    await settled();
    expect(service.get).toHaveBeenCalledWith('doc-1', 'thread-from-peer-3', 'token-1');
    store.destroy();
  });

  it('does not overwrite newer thread state when a stale list response resolves', async () => {
    let resolveList!: (value: ApiThread[]) => void;
    const listPromise = new Promise<ApiThread[]>((resolve) => {
      resolveList = resolve;
    });
    service.list
      .mockReturnValueOnce(listPromise)
      .mockResolvedValue([apiThread({ id: 'thread-new' })]);
    service.createThread.mockResolvedValue(apiThread({ id: 'thread-new' }));

    const { store } = createStore();
    const refreshPromise = store.refresh();

    await store.createThread({ initialComment: { body: [] } });
    expect(store.getThreads().has('thread-new')).toBe(true);

    const publishedMaps: Map<string, ThreadData>[] = [];
    const unsubscribe = store.subscribe((threads) => {
      publishedMaps.push(threads);
    });

    resolveList([]);
    await refreshPromise;
    await settled();

    expect(store.getThreads().has('thread-new')).toBe(true);
    expect(publishedMaps.length).toBeGreaterThan(0);
    for (const map of publishedMaps) {
      expect(map.has('thread-new')).toBe(true);
    }
    unsubscribe();
    store.destroy();
  });

  it('notifies subscribers added when store was read-only once access is upgraded', async () => {
    let canRead = false;
    const { store } = createStore({ canRead: () => canRead });
    const listener = jest.fn();
    store.subscribe(listener);

    await settled();
    expect(listener).not.toHaveBeenCalled();

    canRead = true;
    service.list.mockResolvedValue([apiThread({ id: 'thread-upgraded' })]);
    await store.refresh();

    expect(store.getThreads().has('thread-upgraded')).toBe(true);
    expect(listener).toHaveBeenCalledWith(expect.any(Map));
    expect(listener.mock.calls.at(-1)?.[0].has('thread-upgraded')).toBe(true);
    store.destroy();
  });
});

describe('CommentThreadStoreAuth', () => {
  const auth = new CommentThreadStoreAuth(
    () => 'user-1',
    () => true
  );

  it('requires write access to start a thread or reply', () => {
    expect(auth.canCreateThread()).toBe(true);
    expect(auth.canAddComment()).toBe(true);

    const commentOnly = new CommentThreadStoreAuth(
      () => 'user-1',
      () => true,
      () => false
    );
    expect(commentOnly.canCreateThread()).toBe(false);
    expect(commentOnly.canAddComment()).toBe(true);

    const denied = new CommentThreadStoreAuth(
      () => 'user-1',
      () => false,
      () => false
    );
    expect(denied.canCreateThread()).toBe(false);
    expect(denied.canAddComment()).toBe(false);
  });

  it('follows the server abilities attached to a comment', () => {
    const comment = blockNoteComment();

    expect(
      auth.canUpdateComment({ ...comment, metadata: { abilities: abilities({ update: true }) } })
    ).toBe(true);
    expect(
      auth.canDeleteComment({ ...comment, metadata: { abilities: abilities({ delete: true }) } })
    ).toBe(true);
    expect(auth.canDeleteComment({ ...comment, metadata: { abilities: abilities() } })).toBe(false);
  });

  it('offers a reaction only until the current user has added it', () => {
    const comment = blockNoteComment({
      reactions: [{ emoji: '👍', createdAt: new Date(), userIds: ['user-1'] }],
      metadata: { abilities: abilities() },
    });

    expect(auth.canAddReaction(comment, '🎉')).toBe(true);
    expect(auth.canAddReaction(comment, '👍')).toBe(false);
    expect(auth.canDeleteReaction(comment, '👍')).toBe(true);
    expect(auth.canDeleteReaction(comment, '🎉')).toBe(false);
    expect(
      auth.canAddReaction(
        {
          ...comment,
          metadata: { abilities: abilities({ reactions: false }) },
        },
        '🎉'
      )
    ).toBe(false);
  });
});
