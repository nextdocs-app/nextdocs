/**
 * Tracks rooms with a recently authorized socket.
 *
 * Yhub re-checks permissions only when the API asks it to. Every mutation path
 * publishes an event, but a missed call site (a new feature, a cascade the API
 * could not expand, a dropped HTTP call) would otherwise leave an open socket
 * authorized until the tab closes. Each server sweeps the rooms *it* is serving,
 * so no cross-replica state is needed.
 */
export class ActiveRoomTracker {
  private readonly rooms = new Map<string, number>();

  constructor(private readonly activeWindowMs: number) {}

  touch(docid: string, now: number = Date.now()): void {
    this.rooms.set(docid, now);
  }

  /** Rooms seen inside the active window, oldest first; stale entries are pruned. */
  due(now: number = Date.now()): string[] {
    const cutoff = now - this.activeWindowMs;
    const due: string[] = [];
    for (const [docid, seenAt] of this.rooms) {
      if (seenAt < cutoff) {
        this.rooms.delete(docid);
      } else {
        due.push(docid);
      }
    }
    return due;
  }

  size(): number {
    return this.rooms.size;
  }
}

interface Recheckable<T> {
  recheckAuth(
    docRef: { org: string; docid: string; branch: string },
    opts?: { users?: string[] | null }
  ): Promise<T>;
}

/**
 * Re-authorize every active room on an interval.
 *
 * `recheckAuth` is a Redis message: the server holding the sockets re-runs the
 * auth plugin for each connection and closes the ones whose permission object
 * changed with 4401. A room with no sockets costs almost nothing.
 */
export function startRoomSweep<T>(
  yhub: Recheckable<T>,
  tracker: ActiveRoomTracker,
  options: {
    org: string;
    intervalMs: number;
    onError?: (err: unknown, docid: string) => void;
  }
): () => void {
  let running = false;

  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void (async () => {
      try {
        for (const docid of tracker.due()) {
          try {
            await yhub.recheckAuth({ org: options.org, docid, branch: 'main' });
          } catch (err) {
            options.onError?.(err, docid);
          }
        }
      } finally {
        running = false;
      }
    })();
  }, options.intervalMs);

  // The websocket server keeps the process alive; the sweep must not be the
  // reason a test process or a draining pod stays up.
  timer.unref?.();

  return () => clearInterval(timer);
}
