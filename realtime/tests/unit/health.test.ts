import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { checkStore } from '../../src/health.js';

describe('checkStore', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a store that answers as ok', async () => {
    await expect(checkStore('postgres', async () => 1)).resolves.toEqual(['postgres', 'ok']);
  });

  it('reports a failing store as unreachable without logging its error message', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await checkStore('redis', async () => {
      throw new Error('redis://user:password@host:6379 refused');
    });

    expect(result).toEqual(['redis', 'unreachable']);
    expect(warn).toHaveBeenCalledTimes(1);
    // The message can carry a connection string with its password; a log line leaves
    // the process, so only the failure class is kept.
    const logged = warn.mock.calls[0]?.join(' ') ?? '';
    expect(logged).toContain('Error');
    expect(logged).not.toContain('password');
  });

  it('gives up after the timeout instead of hanging the probe', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const started = Date.now();
    const result = await checkStore('redis-timeout', () => new Promise(() => {}), 25);

    expect(result).toEqual(['redis-timeout', 'unreachable']);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not start a second probe while a timed-out one is still outstanding', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    let settle: (value: unknown) => void = () => {};
    const probe = jest.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );

    await expect(checkStore('redis-slow', probe, 25)).resolves.toEqual([
      'redis-slow',
      'unreachable',
    ]);
    // A scrape arrives while the first command is still unanswered: it waits on the
    // same operation instead of stacking another one on the store.
    await expect(checkStore('redis-slow', probe, 25)).resolves.toEqual([
      'redis-slow',
      'unreachable',
    ]);
    expect(probe).toHaveBeenCalledTimes(1);

    settle('PONG');
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(checkStore('redis-slow', async () => 'PONG', 25)).resolves.toEqual([
      'redis-slow',
      'ok',
    ]);
  });
});
