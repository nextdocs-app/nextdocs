/**
 * Tracks rooms with a recently authorized socket.
 *
 * Yhub re-checks permissions only when the API asks it to. Every mutation path
 * publishes an event, but a missed call site (a new feature, a cascade the API
 * could not expand, a dropped HTTP call) would otherwise leave an open socket
 * authorized until the tab closes. Each server sweeps the rooms *it* is serving,
 * so no cross-replica state is needed.
 *
 * A room is never dropped because it is old: a socket left open for hours is
 * exactly the one a missed revocation would strand, so age alone must not end its
 * rechecks. Rooms are dropped only once a sweep proves they have no connections,
 * which it does by watching whether Yhub re-authorized any of them: `recheckAuth`
 * re-runs the auth plugin for every open connection on that document, and that
 * callback refreshes the room's timestamp.
 */
export class ActiveRoomTracker {
  private readonly rooms = new Map<string, number>();
  /** When the previous sweep started; rooms not re-authorized since then are gone. */
  private previousSweepStartedAt: number | null = null;

  touch(docid: string, now: number = Date.now()): void {
    this.rooms.set(docid, now);
  }

  /**
   * Every tracked room, oldest sighting first. No age cutoff: pruning is based on
   * the absence of a re-authorized socket, not on how long ago one was seen.
   */
  tracked(): string[] {
    return [...this.rooms.entries()].sort((a, b) => a[1] - b[1]).map(([docid]) => docid);
  }

  /**
   * Start a sweep. Returns the cutoff a room must have been re-authorized since to
   * still have a socket: the previous sweep's start, not this one's, because a
   * recheck's authorize callback can land after this sweep's loop finishes. A room
   * whose socket closed is therefore dropped one sweep later, never while active.
   *
   * The first sweep has no earlier boundary to judge against, so it only observes.
   */
  beginSweep(now: number = Date.now()): number | null {
    const cutoff = this.previousSweepStartedAt;
    this.previousSweepStartedAt = now;
    return cutoff;
  }

  /** Drops rooms that no socket re-authorized since `cutoff`. */
  pruneNotSeenSince(cutoff: number): void {
    for (const [docid, seenAt] of this.rooms) {
      if (seenAt < cutoff) {
        this.rooms.delete(docid);
      }
    }
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

/** Rejects when `promise` has not settled within the budget; the work itself continues. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, docid: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`recheckAuth timed out after ${timeoutMs} ms for ${docid}`));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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
    /** How long one room may hold up the rooms behind it. Defaults to 10 s. */
    recheckTimeoutMs?: number;
    onError?: (err: unknown, docid: string) => void;
  }
): () => void {
  let running = false;
  // A timed-out call is not cancelled (Yhub offers no signal), so remember it and
  // never start a second one for the same room while it is still pending. This
  // keeps concurrency bounded by the room count even when the backend hangs.
  const inFlight = new Map<string, Promise<unknown>>();
  const recheckTimeoutMs = options.recheckTimeoutMs ?? 10_000;

  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void (async () => {
      const pruneCutoff = tracker.beginSweep();
      let failed = false;
      try {
        for (const docid of tracker.tracked()) {
          if (inFlight.has(docid)) {
            // The previous recheck for this room never settled. Skip it so the
            // rooms after it still get their turn instead of stalling the sweep.
            failed = true;
            continue;
          }

          const call = Promise.resolve().then(() =>
            yhub.recheckAuth({ org: options.org, docid, branch: 'main' })
          );
          inFlight.set(docid, call);
          const clear = () => {
            if (inFlight.get(docid) === call) {
              inFlight.delete(docid);
            }
          };
          void call.then(clear, clear);

          try {
            await withTimeout(call, recheckTimeoutMs, docid);
          } catch (err) {
            // A failed recheck proves nothing about the sockets, so keep the room
            // and try again next tick instead of losing the safety net.
            failed = true;
            options.onError?.(err, docid);
          }
        }
        if (!failed && pruneCutoff !== null) {
          tracker.pruneNotSeenSince(pruneCutoff);
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
