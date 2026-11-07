import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { ActiveRoomTracker, startRoomSweep } from '../../src/sweep.js';

describe('ActiveRoomTracker', () => {
  it('returns rooms seen inside the active window and prunes older ones', () => {
    const tracker = new ActiveRoomTracker(60_000);
    tracker.touch('a', 1_000);
    tracker.touch('b', 50_000);

    expect(tracker.due(55_000).sort()).toEqual(['a', 'b']);
    // At 100s the cutoff is 40s: b (50s) is still active, a (1s) is not.
    expect(tracker.due(100_000)).toEqual(['b']);
    expect(tracker.size()).toBe(1);
  });

  it('keeps only the latest sighting per room', () => {
    const tracker = new ActiveRoomTracker(10_000);
    tracker.touch('a', 1_000);
    tracker.touch('a', 9_000);

    expect(tracker.due(15_000)).toEqual(['a']);
  });
});

describe('startRoomSweep', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rechecks every active room on its interval', async () => {
    const tracker = new ActiveRoomTracker(60_000);
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
    const tracker = new ActiveRoomTracker(60_000);
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
  });
});
