import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Awareness } from '@y/protocols/awareness';
import { getAvatarBackground } from '@/lib/avatar.util';
import { toSortableTimestamp } from '@/lib/timestamp.util';
import {
  documentService,
  DocumentServiceApiError,
  type DocumentViewerRow,
} from '@/services/document.service';
import { useAppSelector } from '@/stores/hooks';

/** View-history read cadence while the document stays open. */
const VIEWER_REFRESH_INTERVAL_MS = 30_000;

export interface DocumentViewer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  lastViewedAt: string | null;
  /** Connected right now through Yjs awareness (or is the reader). */
  isActive: boolean;
  isCurrentUser: boolean;
  presenceColor: string;
}

/** The `user` field a client publishes into Yhub awareness to describe itself. */
interface PresenceUser {
  id?: string;
  userId?: string;
  name?: string;
  avatarUrl?: string | null;
  color?: string;
}

interface LivePeer {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  color: string | null;
}

/**
 * The last emitted presence round, tagged with the awareness it came from: a document
 * switch builds a new Awareness instance, and its peers must not be read from the old one.
 */
interface PresenceSnapshot {
  awareness: Awareness | null;
  signature: string;
  peers: LivePeer[];
}

const NO_PEERS: PresenceSnapshot = { awareness: null, signature: '', peers: [] };

/** A stack shows a handful plus "+N": a claim beyond this is noise, not presence. */
const MAX_LIVE_PEERS = 50;
/** Display names come off the wire unauthenticated; nothing needs a paragraph. */
const MAX_PRESENCE_NAME_LENGTH = 120;

/**
 * The account photo path the API hands out: `/api/v1/users/{id}/avatar?v={avatarId}`.
 * A peer's awareness state can claim any URL, so only this shape is accepted, and only
 * when the id inside it is the id the same state claims. Anything else falls back to
 * generated initials instead of making every reader's browser fetch a stranger's host.
 */
const PEER_AVATAR_PATH = /^\/api\/v1\/users\/([^/?#]+)\/avatar(?:\?[^#\s]*)?$/;

function peerAvatarUrl(userId: string, claimed: string | null | undefined): string | null {
  if (!claimed) {
    return null;
  }
  const match = PEER_AVATAR_PATH.exec(claimed);
  return match && match[1].toLowerCase() === userId.toLowerCase() ? claimed : null;
}

/**
 * Who is connected right now, read from Yhub awareness.
 *
 * Awareness carries each client's own `user` field, so presence needs no request and
 * no roster lookup: every connection already holds it. The anonymous placeholder
 * guests publish has no id, which keeps deferred guest presence out of the group.
 * A teardown can race the read, which is not worth reporting to the UI.
 */
function readLivePeers(awareness: Awareness): LivePeer[] {
  const peers = new Map<string, LivePeer>();
  let states: Iterable<unknown>;
  try {
    states = awareness.getStates().values();
  } catch {
    // awareness was destroyed mid-read
    return [];
  }

  for (const state of states) {
    // Everything here arrived from another browser: one malformed field must cost that
    // peer its entry, never abort the loop and take every later peer (the reader's own
    // row included) down with it.
    const user = (state as { user?: unknown } | null)?.user;
    if (!user || typeof user !== 'object') {
      continue;
    }
    const claimed = user as Record<string, unknown>;
    const userId =
      typeof claimed.id === 'string'
        ? claimed.id
        : typeof claimed.userId === 'string'
          ? claimed.userId
          : null;
    if (!userId || userId === 'anonymous') {
      continue;
    }
    // Dedupe before the cap: a reader at the limit still sees a name or photo change
    // from someone already in the group.
    if (!peers.has(userId) && peers.size >= MAX_LIVE_PEERS) {
      continue;
    }
    const name =
      typeof claimed.name === 'string'
        ? claimed.name.trim().slice(0, MAX_PRESENCE_NAME_LENGTH)
        : '';
    peers.set(userId, {
      userId,
      displayName: name || null,
      avatarUrl:
        typeof claimed.avatarUrl === 'string' ? peerAvatarUrl(userId, claimed.avatarUrl) : null,
      color: typeof claimed.color === 'string' ? claimed.color : null,
    });
  }
  return [...peers.values()];
}

/**
 * Stable comparison key: awareness fires on every cursor move, and the identity
 * behind it changes far less often. Same people, different cursors keeps the
 * previous array so nothing downstream re-renders.
 */
function presenceSignature(peers: LivePeer[]): string {
  return peers
    .map((peer) =>
      [peer.userId, peer.displayName ?? '', peer.avatarUrl ?? '', peer.color ?? ''].join('\u0000')
    )
    .join('\u0001');
}

/**
 * The people who have read this document: durable view history from the API, with
 * live presence from Yhub awareness layered on top.
 *
 * The two halves answer different questions and fail independently. History is a
 * stored fact, so anyone who opened the page appears even after they left (and after
 * their access was revoked); presence is the socket's own state, so a peer shows up
 * the moment they arrive without waiting for the next history read. Presence must
 * never drive the network: the roster read and the visit write ignore awareness
 * churn, and a cursor move can never turn into a request.
 */
export function useDocumentViewers({
  documentId,
  awareness,
}: {
  documentId: string;
  awareness?: Awareness | null;
}): DocumentViewer[] {
  const accessToken = useAppSelector((state) => state?.auth?.accessToken ?? null);
  const currentUserId = useAppSelector((state) => state?.auth?.user?.id ?? null);
  const viewerKey = `${documentId}:${currentUserId ?? ''}`;
  // Anonymous viewing is not tracked yet: without an account there is no history row
  // and no identity to publish, so a guest neither records a visit nor sees the group.
  const canTrackViewers = !!accessToken && !!currentUserId;

  const [history, setHistory] = useState<{ key: string; rows: DocumentViewerRow[] } | null>(null);
  const [live, setLive] = useState<PresenceSnapshot>(NO_PEERS);
  const historyRequestIdRef = useRef(0);
  const accessTokenRef = useRef(accessToken);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!awareness) {
      return;
    }
    const sync = () => {
      const peers = readLivePeers(awareness);
      const signature = presenceSignature(peers);
      setLive((previous) =>
        previous.awareness === awareness && previous.signature === signature
          ? previous
          : { awareness, signature, peers }
      );
    };

    sync();
    awareness.on('change', sync);
    return () => {
      awareness.off('change', sync);
    };
  }, [awareness]);

  useEffect(() => {
    return () => {
      historyRequestIdRef.current += 1;
    };
  }, [canTrackViewers, viewerKey]);

  const loadHistory = useCallback(
    (token: string) => {
      const requestId = ++historyRequestIdRef.current;
      return documentService
        .listViewers(documentId, token)
        .then((rows) => {
          if (historyRequestIdRef.current !== requestId) {
            return;
          }
          setHistory({ key: viewerKey, rows });
        })
        .catch((error) => {
          if (historyRequestIdRef.current !== requestId) {
            return;
          }
          // A page the caller can no longer read has no view history to show; a
          // transient failure keeps the last good answer instead of blanking the group.
          if (
            error instanceof DocumentServiceApiError &&
            (error.status === 403 || error.status === 404)
          ) {
            setHistory({ key: viewerKey, rows: [] });
          }
        });
    },
    [documentId, viewerKey]
  );

  // One write per visit: opening the document and coming back to the tab. The read
  // that follows it is what puts the reader in their own group on first paint.
  useEffect(() => {
    if (!canTrackViewers) {
      return;
    }
    let cancelled = false;
    const record = () => {
      if (document.visibilityState === 'hidden') return;
      const token = accessTokenRef.current;
      if (!token) return;
      void documentService
        .recordView(documentId, token)
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          const latestToken = accessTokenRef.current;
          if (latestToken) {
            void loadHistory(latestToken);
          }
        });
    };

    record();
    document.addEventListener('visibilitychange', record);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', record);
    };
  }, [canTrackViewers, documentId, loadHistory]);

  // Reads only: the poll refreshes `lastViewedAt`, it never writes one. Returning to
  // the tab is already covered by the visit effect above (write + re-read), so this
  // effect deliberately adds no second listener for the same event.
  useEffect(() => {
    if (!canTrackViewers) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const token = accessTokenRef.current;
      if (!token) return;
      void loadHistory(token);
    };

    const refreshTimer = window.setInterval(refresh, VIEWER_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [canTrackViewers, loadHistory]);

  return useMemo(() => {
    if (!currentUserId) {
      return [];
    }

    const viewers = new Map<string, DocumentViewer>();
    if (history && history.key === viewerKey) {
      for (const row of history.rows) {
        viewers.set(row.userId, {
          userId: row.userId,
          displayName: row.displayName,
          avatarUrl: row.avatarUrl,
          lastViewedAt: row.lastViewedAt,
          isActive: false,
          isCurrentUser: row.userId === currentUserId,
          presenceColor: getAvatarBackground(row.userId),
        });
      }
    }

    // Presence is advisory: a peer's `user` field is whatever their client sent, so a
    // stored history row always wins the name and photo for a known id, and a claimed
    // id nobody has read cannot borrow someone else's profile. Presence only fills in
    // the identity for someone whose visit has not been read back yet.
    const peers = live.awareness === (awareness ?? null) ? live.peers : [];
    for (const peer of peers) {
      const known = viewers.get(peer.userId);
      viewers.set(peer.userId, {
        userId: peer.userId,
        // `known` wins even when its avatar is null: "this account has no photo" is an
        // answer, and it must not be replaced by whatever the peer claimed.
        displayName: known ? known.displayName : (peer.displayName ?? 'Someone'),
        avatarUrl: known ? known.avatarUrl : peer.avatarUrl,
        lastViewedAt: known?.lastViewedAt ?? null,
        isActive: true,
        isCurrentUser: peer.userId === currentUserId,
        presenceColor: peer.color ?? getAvatarBackground(peer.userId),
      });
    }

    const self = viewers.get(currentUserId);
    if (self) {
      // The reader is looking at the page by definition, even without a socket.
      viewers.set(currentUserId, { ...self, isActive: true, isCurrentUser: true });
    }

    return [...viewers.values()].sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      return toSortableTimestamp(right.lastViewedAt) - toSortableTimestamp(left.lastViewedAt);
    });
  }, [awareness, currentUserId, history, live, viewerKey]);
}
