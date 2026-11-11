import { describe, expect, it, jest } from '@jest/globals';
import { installShutdownHandlers } from '../../src/shutdown.js';

type SignalHandlers = Record<string, () => void>;

function harness(destroy: jest.Mock) {
  const handlers: SignalHandlers = {};
  const exit = jest.fn();
  const log = jest.fn();

  installShutdownHandlers({ destroy } as unknown as { destroy: () => Promise<void> }, {
    signals: {
      once: (event, listener) => {
        handlers[event] = listener;
      },
    },
    exit,
    log,
  });

  return { handlers, exit, log };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('installShutdownHandlers', () => {
  it('drains Yhub with a budget and exits cleanly on SIGTERM', async () => {
    const destroy = jest.fn(async () => {});
    const { handlers, exit } = harness(destroy);

    handlers.SIGTERM();
    await flush();

    expect(destroy).toHaveBeenCalledWith({ drainMs: 5000 });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('treats SIGINT the same way', async () => {
    const destroy = jest.fn(async () => {});
    const { handlers, exit } = harness(destroy);

    handlers.SIGINT();
    await flush();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('drains only once when a second signal arrives mid-drain', async () => {
    let finishDrain: (() => void) | undefined;
    const destroy = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDrain = resolve;
        })
    );
    const { handlers, exit } = harness(destroy);

    handlers.SIGTERM();
    handlers.SIGINT();
    await flush();

    expect(destroy).toHaveBeenCalledTimes(1);
    finishDrain?.();
    await flush();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits non-zero when the drain fails', async () => {
    const destroy = jest.fn(async () => {
      throw new Error('worker is stuck');
    });
    const { handlers, exit, log } = harness(destroy);

    handlers.SIGTERM();
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
    // The message can carry a connection string, so only the failure class is logged.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Error'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('worker is stuck'));
  });

  it('forces an exit when the drain never settles', async () => {
    const destroy = jest.fn(() => new Promise<void>(() => {}));
    const handlers: SignalHandlers = {};
    const exit = jest.fn();
    const log = jest.fn();

    installShutdownHandlers({ destroy } as unknown as { destroy: () => Promise<void> }, {
      signals: {
        once: (event, listener) => {
          handlers[event] = listener;
        },
      },
      exit,
      log,
      forceExitMs: 10,
    });

    handlers.SIGTERM();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(exit).toHaveBeenCalledWith(1);
  });
});
