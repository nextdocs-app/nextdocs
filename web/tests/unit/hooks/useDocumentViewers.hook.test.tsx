import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import type { Awareness } from '@y/protocols/awareness';
import { useDocumentViewers } from '../../../hooks/useDocumentViewers.hook';
import authReducer, { refreshSessionThunk } from '../../../stores/auth/auth.slice';
import {
  documentService,
  DocumentServiceApiError,
  type DocumentViewerRow,
} from '../../../services/document.service';

jest.mock('../../../services/document.service', () => ({
  DocumentServiceApiError: class DocumentServiceApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  documentService: {
    listViewers: jest.fn(),
    recordView: jest.fn(),
  },
}));

const listViewers = documentService.listViewers as jest.Mock;
const recordView = documentService.recordView as jest.Mock;

type PresenceState = {
  user?: { id?: string; userId?: string; name?: string; avatarUrl?: string | null; color?: string };
};
type AwarenessStates = Map<number, PresenceState>;

/** A UUID-shaped value, for the avatar path the API hands out. */
function uuid(): string {
  return '5cd3feaa-e490-4628-ac26-500f7b075edc';
}

function createStore({
  accessToken = 'access-token',
  userId = 'user-1' as string | null,
}: { accessToken?: string | null; userId?: string | null } = {}) {
  return configureStore({
    reducer: combineReducers({ auth: authReducer }),
    preloadedState: {
      auth: {
        user: userId
          ? { id: userId, email: 'ada@example.com', displayName: 'Ada', avatarUrl: null }
          : null,
        accessToken,
        expiresAt: accessToken ? Date.now() + 60_000 : null,
        lastSilentRefreshAt: null,
        sessionId: 0,
        isInitializing: false,
      },
    },
  });
}

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function row(overrides: Partial<DocumentViewerRow> & { userId: string }): DocumentViewerRow {
  return {
    displayName: overrides.userId,
    avatarUrl: null,
    lastViewedAt: null,
    ...overrides,
  };
}

function createFakeAwareness(initialStates: AwarenessStates = new Map()) {
  let states = initialStates;
  const listeners = new Set<() => void>();

  const awareness = {
    getStates: () => states,
    on: (_event: string, listener: () => void) => {
      listeners.add(listener);
    },
    off: (_event: string, listener: () => void) => {
      listeners.delete(listener);
    },
  } as unknown as Awareness;

  return {
    awareness,
    setStates(next: AwarenessStates) {
      states = next;
    },
    /** What `@y/protocols` does on every cursor move, local edits included. */
    emitChange() {
      for (const listener of listeners) {
        listener();
      }
    },
    listenerCount: () => listeners.size,
  };
}

function renderViewers(
  options: {
    awareness?: Awareness | null;
    documentId?: string;
    accessToken?: string | null;
    userId?: string | null;
  } = {}
) {
  const store = createStore({
    accessToken: options.accessToken === undefined ? 'access-token' : options.accessToken,
    userId: options.userId === undefined ? 'user-1' : options.userId,
  });
  return {
    store,
    ...renderHook(
      (props: { documentId: string }) =>
        useDocumentViewers({
          documentId: props.documentId,
          awareness: options.awareness ?? null,
        }),
      {
        initialProps: { documentId: options.documentId ?? 'doc-1' },
        wrapper: wrapperFor(store),
      }
    ),
  };
}

describe('useDocumentViewers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listViewers.mockResolvedValue([]);
    recordView.mockResolvedValue(undefined);
  });

  it('records one visit and reads the history and nothing more', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);
    const fake = createFakeAwareness(new Map([[1, { user: { id: 'user-1' } }]]));

    const { result } = renderViewers({ awareness: fake.awareness });

    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-1']));
    expect(recordView).toHaveBeenCalledTimes(1);
    expect(recordView).toHaveBeenCalledWith('doc-1', 'access-token');
    // The read follows the write, so the reader is in their own group on first paint.
    expect(listViewers).toHaveBeenCalledTimes(1);

    act(() => {
      for (let index = 0; index < 10; index += 1) {
        // A new awareness round with the same single participant, which is what
        // every keystroke produces locally.
        fake.setStates(new Map([[index, { user: { id: 'user-1' } }]]));
        fake.emitChange();
      }
    });

    expect(recordView).toHaveBeenCalledTimes(1);
    expect(listViewers).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toMatchObject({ isActive: true, isCurrentUser: true });
  });

  it('shows stored history without any socket', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-2', lastViewedAt: '2026-01-02T00:00:00Z', displayName: 'Bob' }),
    ]);

    const { result } = renderViewers({ awareness: null });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({
      userId: 'user-2',
      displayName: 'Bob',
      isActive: false,
      isCurrentUser: false,
    });
  });

  it('adds a live peer the history does not know yet, from awareness alone', async () => {
    const adaAvatar = `/api/v1/users/user-1/avatar?v=${uuid()}`;
    const bobAvatar = `/api/v1/users/user-2/avatar?v=${uuid()}`;
    listViewers.mockResolvedValue([
      row({
        userId: 'user-1',
        displayName: 'Ada',
        avatarUrl: adaAvatar,
        lastViewedAt: '2026-01-01T00:00:00Z',
      }),
    ]);
    const fake = createFakeAwareness(
      new Map([
        [1, { user: { id: 'user-1', name: 'Ada', avatarUrl: adaAvatar, color: '#123456' } }],
        [2, { user: { id: 'user-2', name: 'Bob', avatarUrl: bobAvatar } }],
      ])
    );

    const { result } = renderViewers({ awareness: fake.awareness });

    await waitFor(() =>
      expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-1', 'user-2'])
    );
    expect(result.current[1]).toMatchObject({
      displayName: 'Bob',
      avatarUrl: bobAvatar,
      lastViewedAt: null,
      isActive: true,
    });
    await waitFor(() =>
      expect(result.current[0]).toMatchObject({
        displayName: 'Ada',
        avatarUrl: adaAvatar,
        lastViewedAt: '2026-01-01T00:00:00Z',
        presenceColor: '#123456',
      })
    );
  });

  it('keeps the stored identity when a live peer claims a different one', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-2', displayName: 'Robert', lastViewedAt: '2026-01-01T00:00:00Z' }),
    ]);
    const fake = createFakeAwareness(new Map([[1, { user: { id: 'user-2', name: 'Bob' } }]]));

    const { result } = renderViewers({ awareness: fake.awareness });

    await waitFor(() =>
      expect(result.current[0]).toMatchObject({
        userId: 'user-2',
        // Presence is advisory: a claimed id cannot rename a real reader.
        displayName: 'Robert',
        lastViewedAt: '2026-01-01T00:00:00Z',
        isActive: true,
      })
    );
  });

  it('refuses an avatar URL that is not this user’s own profile photo', async () => {
    const otherUserId = uuid();
    const fake = createFakeAwareness(
      new Map([
        [1, { user: { id: 'user-2', name: 'Bob', avatarUrl: 'https://tracker.test/pixel.gif' } }],
        [
          2,
          {
            user: {
              id: 'user-3',
              name: 'Cara',
              // A real API path, but for a different person's photo.
              avatarUrl: `/api/v1/users/${otherUserId}/avatar?v=${uuid()}`,
            },
          },
        ],
        [3, { user: { id: 'user-4', name: 'Dan', avatarUrl: 'data:image/svg+xml;base64,AAAA' } }],
      ])
    );

    const { result } = renderViewers({ awareness: fake.awareness });

    // Presence never makes this browser fetch a stranger's host, and never borrows
    // another account's photo: initials are the safe fallback.
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((viewer) => viewer.avatarUrl)).toEqual([null, null, null]);
  });

  it('names a live peer that published no name', async () => {
    const fake = createFakeAwareness(new Map([[1, { user: { id: 'user-9' } }]]));

    const { result } = renderViewers({ awareness: fake.awareness });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({ displayName: 'Someone', isActive: true });
  });

  it('orders live presence first, then the most recent visit', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-01T00:00:00Z' }),
      row({ userId: 'user-2', lastViewedAt: '2026-01-05T00:00:00Z' }),
      row({ userId: 'user-3', lastViewedAt: '2026-01-03T00:00:00Z' }),
    ]);
    const fake = createFakeAwareness(
      new Map([
        [1, { user: { id: 'user-1' } }],
        [2, { user: { id: 'user-2' } }],
      ])
    );

    const { result } = renderViewers({ awareness: fake.awareness });

    await waitFor(() =>
      expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-2', 'user-1', 'user-3'])
    );
  });

  it('keeps the stored avatar over a live peer’s claim', async () => {
    listViewers.mockResolvedValue([
      // The account has no photo, which is what the server says it looks like.
      row({
        userId: 'user-2',
        displayName: 'Bob',
        avatarUrl: null,
        lastViewedAt: '2026-01-02T00:00:00Z',
      }),
    ]);
    const fake = createFakeAwareness(
      new Map([
        [
          1,
          {
            user: {
              id: 'user-2',
              name: 'Bob',
              avatarUrl: `/api/v1/users/user-2/avatar?v=${uuid()}`,
            },
          },
        ],
      ])
    );

    const { result } = renderViewers({ awareness: fake.awareness });

    await waitFor(() =>
      expect(result.current[0]).toMatchObject({
        isActive: true,
        lastViewedAt: '2026-01-02T00:00:00Z',
      })
    );
    // The stored row is authoritative for a known person, photo included.
    expect(result.current[0].avatarUrl).toBeNull();
  });

  it('lets one malformed presence state cost only that peer', async () => {
    const states = new Map([
      [1, { user: { id: 'user-2', name: 'Bob' } }],
      [2, { user: { id: 7, name: 'Broken', avatarUrl: '/api/v1/users/x/avatar' } }],
      [3, { user: { id: 'user-3', name: 42 } }],
      [4, { user: 'not-an-object' }],
      [5, { user: { id: 'user-4', name: 'Dan' } }],
    ]) as unknown as AwarenessStates;

    const { result } = renderViewers({ awareness: createFakeAwareness(states).awareness });

    // user-3's numeric name is not a name, but its identity still counts.
    await waitFor(() =>
      expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-2', 'user-3', 'user-4'])
    );
    expect(result.current[1].displayName).toBe('Someone');
  });

  it('caps the live peers it renders', async () => {
    const states: AwarenessStates = new Map(
      Array.from({ length: 60 }, (_, index) => [
        index,
        { user: { id: `user-${index + 1}`, name: `Person ${index + 1}` } },
      ])
    );

    const { result } = renderViewers({ awareness: createFakeAwareness(states).awareness });

    // A crowd is presence, not the durable group: the stored head still arrives with
    // the history read, so bounding the live half cannot hide a real reader.
    await waitFor(() => expect(result.current).toHaveLength(50));
  });

  it('ignores the anonymous guest placeholder and entries without an id', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-2', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);
    const states: AwarenessStates = new Map([
      [1, { user: { id: 'anonymous', name: 'Guest' } }],
      [2, { user: {} }],
      [3, {}],
      [4, { user: { id: 'user-2', name: 'Bob' } }],
    ]);

    const { result } = renderViewers({ awareness: createFakeAwareness(states).awareness });

    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-2']));
    expect(result.current[0]).toMatchObject({ isActive: true, isCurrentUser: false });
  });

  it('reads the userId alias awareness also carries', async () => {
    const states = new Map([[1, { user: { userId: 'user-2', name: 'Bob' } }]]) as AwarenessStates;

    const { result } = renderViewers({ awareness: createFakeAwareness(states).awareness });

    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-2']));
  });

  it('survives an awareness read that races its own teardown', async () => {
    const brokenAwareness = {
      getStates: () => {
        throw new Error('destroyed');
      },
      on: jest.fn(),
      off: jest.fn(),
    } as unknown as Awareness;
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);

    const { result } = renderViewers({ awareness: brokenAwareness });

    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-1']));
    expect(result.current[0].isActive).toBe(true);
  });

  it('records and reads nothing without a session', async () => {
    const fake = createFakeAwareness(new Map([[1, { user: { id: 'user-2', name: 'Bob' } }]]));

    const guest = renderViewers({ awareness: fake.awareness, accessToken: null, userId: null });

    await act(async () => {
      await Promise.resolve();
    });

    expect(recordView).not.toHaveBeenCalled();
    expect(listViewers).not.toHaveBeenCalled();
    // Anonymous viewing is deferred: a guest neither records a visit nor sees the group.
    expect(guest.result.current).toEqual([]);
  });

  it('records a visit only while the page is visible', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });

    try {
      const { unmount } = renderViewers({ awareness: createFakeAwareness().awareness });
      await act(async () => {
        await Promise.resolve();
      });
      expect(recordView).not.toHaveBeenCalled();

      listViewers.mockResolvedValue([row({ userId: 'user-1' })]);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => expect(recordView).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(listViewers).toHaveBeenCalled());
      unmount();
    } finally {
      if (descriptor) {
        Object.defineProperty(document, 'visibilityState', descriptor);
      } else {
        // jsdom keeps the getter on the prototype; an own override needs removing.
        delete (document as unknown as { visibilityState?: string }).visibilityState;
      }
    }
  });

  it('clears the group when the document is no longer readable', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);
    const { result } = renderViewers({ awareness: createFakeAwareness().awareness });
    await waitFor(() => expect(result.current).toHaveLength(1));

    listViewers.mockRejectedValue(new DocumentServiceApiError('Not found', 404));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('keeps the last good group when a refresh fails transiently', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);
    const { result } = renderViewers({ awareness: createFakeAwareness().awareness });
    await waitFor(() => expect(result.current).toHaveLength(1));

    listViewers.mockRejectedValue(new Error('network down'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(listViewers).toHaveBeenCalledTimes(2));
    expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-1']);
  });

  it('hides the previous document’s group while another loads', async () => {
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);
    const { result, rerender } = renderViewers({ awareness: createFakeAwareness().awareness });
    await waitFor(() => expect(result.current).toHaveLength(1));

    let resolveNext: (rows: DocumentViewerRow[]) => void = () => {};
    listViewers.mockImplementation(() => new Promise((resolve) => (resolveNext = resolve)));
    rerender({ documentId: 'doc-2' });
    await waitFor(() => expect(listViewers).toHaveBeenCalledTimes(2));

    // The old document's readers must not linger over the one still loading.
    expect(result.current.map((viewer) => viewer.userId)).not.toContain('user-1');

    await act(async () => {
      resolveNext([row({ userId: 'user-3', lastViewedAt: '2026-01-03T00:00:00Z' })]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-3']));
  });

  it('swallows a failed visit write and still reads the history', async () => {
    recordView.mockRejectedValue(new Error('offline'));
    listViewers.mockResolvedValue([
      row({ userId: 'user-1', lastViewedAt: '2026-01-02T00:00:00Z' }),
    ]);

    const { result } = renderViewers({ awareness: createFakeAwareness().awareness });

    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-1']));
    expect(listViewers).toHaveBeenCalledTimes(1);
  });

  it('ignores obsolete history responses after switching documents', async () => {
    let resolveDoc1: (rows: DocumentViewerRow[]) => void = () => {};
    let rejectDoc2: (error: unknown) => void = () => {};
    listViewers
      .mockImplementationOnce(() => new Promise((resolve) => (resolveDoc1 = resolve)))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectDoc2 = reject)))
      .mockResolvedValueOnce([row({ userId: 'user-3', lastViewedAt: '2026-01-04T00:00:00Z' })]);

    const { result, rerender } = renderViewers({
      documentId: 'doc-1',
      awareness: createFakeAwareness().awareness,
    });
    await waitFor(() => expect(listViewers).toHaveBeenCalledTimes(1));

    rerender({ documentId: 'doc-2' });
    await waitFor(() => expect(listViewers).toHaveBeenCalledTimes(2));

    rerender({ documentId: 'doc-3' });
    await waitFor(() => expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-3']));

    await act(async () => {
      resolveDoc1([row({ userId: 'user-1', lastViewedAt: '2026-01-01T00:00:00Z' })]);
      rejectDoc2(new DocumentServiceApiError('Not found', 404));
      await Promise.resolve();
    });

    expect(result.current.map((viewer) => viewer.userId)).toEqual(['user-3']);
  });

  it('does not record a new visit when the access token rotates, and uses the latest token on return', async () => {
    const { store } = renderViewers({ awareness: createFakeAwareness().awareness });
    await waitFor(() => expect(recordView).toHaveBeenCalledWith('doc-1', 'access-token'));
    await waitFor(() => expect(listViewers).toHaveBeenCalledWith('doc-1', 'access-token'));

    act(() => {
      store.dispatch(
        refreshSessionThunk.fulfilled(
          {
            accessToken: 'rotated-token',
            tokenType: 'Bearer',
            expiresIn: 60,
            user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada', avatarUrl: null },
          },
          'req-1',
          undefined
        )
      );
    });

    expect(recordView).toHaveBeenCalledTimes(1);
    expect(listViewers).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(recordView).toHaveBeenCalledWith('doc-1', 'rotated-token'));
    await waitFor(() => expect(listViewers).toHaveBeenCalledWith('doc-1', 'rotated-token'));
  });
});
