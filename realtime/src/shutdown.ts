import { describeError } from './health.js';

/** The part of the Yhub handle shutdown needs. */
export interface DrainableServer {
  destroy(options?: { drainMs?: number }): Promise<void> | void;
}

export interface ShutdownDeps {
  /** Signal source; defaults to the process. Tests pass a recorder. */
  signals?: { once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown };
  exit?: (code: number) => void;
  log?: (message: string) => void;
  drainMs?: number;
  /** Hard stop after this long, so a wedged worker cannot outlive the stop grace. */
  forceExitMs?: number;
}

export const SHUTDOWN_DRAIN_MS = 5_000;
const FORCE_EXIT_GRACE_MS = 5_000;

/**
 * Drain Yhub on SIGTERM/SIGINT instead of dying on Node's default handler.
 *
 * Docker sends SIGTERM to PID 1; without a handler Node exits immediately, so a
 * deploy drops every socket with no close frame and leaves pending compaction
 * tasks unflushed — a planned restart looks exactly like a network fault to
 * every client. `destroy({ drainMs })` closes connections gracefully and waits
 * for the worker; the forced exit bounds the whole thing so a wedged task cannot
 * hold a deploy past its stop grace period.
 */
export function installShutdownHandlers(server: DrainableServer, deps: ShutdownDeps = {}): void {
  const signals = deps.signals ?? process;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((message: string) => console.log(message));
  const drainMs = deps.drainMs ?? SHUTDOWN_DRAIN_MS;
  const forceExitMs = deps.forceExitMs ?? drainMs + FORCE_EXIT_GRACE_MS;
  let stopping = false;

  const stop = (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    log(`Received ${signal}: draining realtime server...`);

    const force = setTimeout(() => {
      log('Realtime server did not drain in time; exiting.');
      exit(1);
    }, forceExitMs);
    force.unref?.();

    Promise.resolve(server.destroy({ drainMs })).then(
      () => {
        clearTimeout(force);
        exit(0);
      },
      (err) => {
        clearTimeout(force);
        log(`Realtime server failed to drain: ${describeError(err)}`);
        exit(1);
      }
    );
  };

  signals.once('SIGTERM', () => stop('SIGTERM'));
  signals.once('SIGINT', () => stop('SIGINT'));
}
