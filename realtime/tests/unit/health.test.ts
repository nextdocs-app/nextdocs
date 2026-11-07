import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { checkStore } from '../../src/health.js';

describe('checkStore', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a store that answers as ok', async () => {
    await expect(checkStore('postgres', async () => 1)).resolves.toEqual(['postgres', 'ok']);
  });

  it('reports a failing store as unreachable and keeps the error out of the result', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await checkStore('redis', async () => {
      throw new Error('redis://user:password@host:6379 refused');
    });

    expect(result).toEqual(['redis', 'unreachable']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('refused');
  });

  it('gives up after the timeout instead of hanging the probe', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const started = Date.now();
    const result = await checkStore('redis', () => new Promise(() => {}), 25);

    expect(result).toEqual(['redis', 'unreachable']);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
