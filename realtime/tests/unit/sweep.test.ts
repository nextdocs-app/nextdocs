import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { ActiveRoomTracker, startRoomSweep } from '../../src/sweep.js';

describe('ActiveRoomTracker', () => {
  it('keeps rooms regardless of age so a long-lived socket is still swept', () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('a', 1_000);
    tracker.touch('b', 50_000);

    // An hour later both are still tracked: age alone must never stop the rechecks,
    // because the room with an open socket is the one a missed revocation strands.
    expect(tracker.tracked().sort()).toEqual(['a', 'b']);
    expect(tracker.size()).toBe(2);
  });

  it('keeps only the latest sighting per room', () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('a', 1_000);
    tracker.touch('a', 9_000);

    expect(tracker.tracked()).toEqual(['a']);
  });

  it('prunes only rooms no socket re-authorized since the sweep boundary', () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('closed', 1_000);
    tracker.touch('open', 1_000);

    // First sweep observes only: there is no earlier boundary to judge against.
    expect(tracker.beginSweep(10_000)).toBeNull();
    // The open room's socket re-authorized during that sweep.
    tracker.touch('open', 10_500);

    const cutoff = tracker.beginSweep(20_000);
    expect(cutoff).toBe(10_000);
    tracker.pruneNotSeenSince(cutoff!);

    expect(tracker.tracked()).toEqual(['open']);
  });
});

describe('startRoomSweep', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rechecks every tracked room on its interval', async () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('11111111-1111-4111-8111-111111111111');
    tracker.touch('22222222-2222-4222-8222-222222222222');

    const recheckAuth = jest.fn(async () => {});
    const stop = startRoomSweep({ recheckAuth }, tracker, {
      org: 'nextdocs',
      intervalMs: 1_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    stop();

    expect(recheckAuth).toHaveBeenCalledTimes(2);
    expect(recheckAuth).toHaveBeenCalledWith({
      org: 'nextdocs',
      docid: '11111111-1111-4111-8111-111111111111',
      branch: 'main',
    });
    expect(recheckAuth).toHaveBeenCalledWith({
      org: 'nextdocs',
      docid: '22222222-2222-4222-8222-222222222222',
      branch: 'main',
    });
  });

  it('keeps sweeping other rooms when one recheck fails', async () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('a');
    tracker.touch('b');

    const recheckAuth = jest.fn(async (docRef: { docid: string }) => {
      if (docRef.docid === 'a') {
        throw new Error('redis unavailable');
      }
    });
    const onError = jest.fn();
    const stop = startRoomSweep({ recheckAuth }, tracker, {
      org: 'nextdocs',
      intervalMs: 500,
      onError,
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    stop();

    expect(recheckAuth).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe('a');
    // A failed recheck proves nothing about the sockets, so the room is not dropped.
    expect(tracker.tracked().sort()).toEqual(['a', 'b']);
  });

  it('times out one stalled recheck so later rooms still get theirs', async () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('a');
    tracker.touch('b');

    const recheckAuth = jest.fn((docRef: { docid: string }) => {
      // `a` never settles: a stopped worker or a wedged Redis call.
      if (docRef.docid === 'a') {
        return new Promise<void>(() => {});
      }
      return Promise.resolve();
    });
    const onError = jest.fn();
    const stop = startRoomSweep({ recheckAuth }, tracker, {
      org: 'nextdocs',
      intervalMs: 50,
      recheckTimeoutMs: 30,
      onError,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();

    expect(recheckAuth).toHaveBeenCalledWith(expect.objectContaining({ docid: 'b' }));
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'a');
    // The stalled room was not proven dead, so it stays tracked.
    expect(tracker.tracked()).toContain('a');
  });

  it('keeps a room last seen before the cutoff when a later recheck fails', async () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('unknown');

    let laterSweep = false;
    const recheckAuth = jest.fn(async () => {
      if (laterSweep) {
        throw new Error('redis unavailable');
      }
    });
    const stop = startRoomSweep({ recheckAuth }, tracker, {
      org: 'nextdocs',
      intervalMs: 100,
    });

    // First sweep only observes; the room's sighting predates that cutoff.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(tracker.size()).toBe(1);

    laterSweep = true;
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop();

    // The second sweep has a cutoff and the room failed it, but a failed recheck
    // proves nothing about the sockets: pruning would drop a live room.
    expect(tracker.tracked()).toContain('unknown');
  });

  it('drops a room after a later sweep proves no socket re-authorized it', async () => {
    const tracker = new ActiveRoomTracker();
    tracker.touch('dead-room');

    const stop = startRoomSweep({ recheckAuth: jest.fn(async () => {}) }, tracker, {
      org: 'nextdocs',
      intervalMs: 100,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    // The first sweep only observes; it cannot know the room is dead yet.
    expect(tracker.size()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(tracker.size()).toBe(0);
    stop();
  });
});
