import { LOG_LEVEL, type LogLevel } from './config.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A leveled, scoped logger over the console.
 *
 * The service is deployed as a single container with `docker logs`, so the console
 * is the transport; what was missing was a level gate and a scope. `LOG_LEVEL`
 * decides which lines leave the process (`debug` for a local session, `warn` for a
 * noisy deployment), and every line names the module that wrote it. Direct `console`
 * calls bypass both, so logging is centralized here.
 */
export function createLogger(scope: string, level: LogLevel = LOG_LEVEL): Logger {
  const threshold = LEVEL_WEIGHT[level];

  const write = (method: keyof Logger, message: string, args: unknown[]): void => {
    if (LEVEL_WEIGHT[method] < threshold) {
      return;
    }
    console[method](`[${scope}] ${message}`, ...args);
  };

  return {
    debug: (message, ...args) => write('debug', message, args),
    info: (message, ...args) => write('info', message, args),
    warn: (message, ...args) => write('warn', message, args),
    error: (message, ...args) => write('error', message, args),
  };
}

/** The server's own logger; other modules create one named for their responsibility. */
export const log = createLogger('realtime');
