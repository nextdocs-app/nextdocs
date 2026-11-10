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

export type RecheckOutcome = 'ok' | 'failed';

/** Rechecks one room at a time defaults to a small pool, not the whole room list. */
export const DEFAULT_RECHECK_CONCURRENCY = 8;

/**
 * Runs room rechecks with a bounded fan-out and one call in flight per audience.
 *
 * A sweep over a few hundred rooms used to await one `recheckAuth` at a time: with a
 * slow API a single pass could outlast the sweep interval, and the next tick was then
 * skipped entirely. The batch endpoint had the mirror-image problem — it ran rooms
 * sequentially too, so one wedged room delayed every room behind it.
 *
 * Sharing the in-flight map between the sweep and the batch endpoint is what keeps a
 * batch that arrives while a sweep is running from doubling the work. A recheck for a
 * different user filter is a different question (it can admit or deny a different set
 * of sockets), so the key includes the audience; identical questions join the same
 * promise.
 */
export class RecheckGate {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly concurrency: number = DEFAULT_RECHECK_CONCURRENCY) {}

  private key(docid: string, users?: string[] | null): string {
    return users && users.length > 0 ? `${docid}\u0000${[...users].sort().join(',')}` : docid;
  }

  /**
   * Rechecks every docid at most once concurrently, up to `concurrency` at a time.
   * Returns when every room has settled or the batch was skipped.
   */
  async run(
    docids: readonly string[],
    recheck: (docid: string) => Promise<unknown>,
    options: {
      users?: string[] | null;
      timeoutMs?: number;
      onResult?: (docid: string, outcome: RecheckOutcome, err?: unknown) => void;
    } = {}
  ): Promise<void> {
    const queue = [...new Set(docids)];
    let next = 0;

    const worker = async () => {
      while (next < queue.length) {
        const docid = queue[next++];
        const key = this.key(docid, options.users);

        // Join an identical recheck already on the wire instead of issuing a second
        // one; a timed-out call is not cancelled, so this is what bounds the work.
        let call = this.inFlight.get(key);
        if (!call) {
          const started = Promise.resolve().then(() => recheck(docid));
          this.inFlight.set(key, started);
          const clear = () => {
            if (this.inFlight.get(key) === started) {
              this.inFlight.delete(key);
            }
          };
          void started.then(clear, clear);
          call = started;
        }

        try {
          await (options.timeoutMs ? withTimeout(call, options.timeoutMs, docid) : call);
          options.onResult?.(docid, 'ok');
        } catch (err) {
          // One wedged room must not hold up the rooms behind it; the caller decides
          // whether a failure (or a timeout) means the sweep may prune.
          options.onResult?.(docid, 'failed', err);
        }
      }
    };

    const workers = Math.min(Math.max(1, this.concurrency), queue.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
}

/** Rejects when `promise` has not settled within the budget; the work itself continues. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, docid: string): Promise<T> {
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
    /** Share this with the batch endpoint so both see the same in-flight calls. */
    gate?: RecheckGate;
    /** Rooms rechecked in parallel. Ignored when `gate` is supplied. */
    concurrency?: number;
    onError?: (err: unknown, docid: string) => void;
  }
): () => void {
  let running = false;
  const gate = options.gate ?? new RecheckGate(options.concurrency);
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
        // A bounded pool, not one room at a time: a slow API must not make one sweep
        // outlast the interval, and a room already being rechecked is joined rather
        // than duplicated. A rejected or timed-out recheck proves nothing about the
        // sockets, so it keeps the room and blocks pruning for this pass.
        await gate.run(
          tracker.tracked(),
          (docid) =>
            Promise.resolve().then(() =>
              yhub.recheckAuth({ org: options.org, docid, branch: 'main' })
            ),
          {
            timeoutMs: recheckTimeoutMs,
            onResult: (docid, outcome, err) => {
              if (outcome === 'failed') {
                failed = true;
                options.onError?.(err, docid);
              }
            },
          }
        );
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
