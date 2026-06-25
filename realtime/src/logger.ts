/* eslint-disable no-console */
import config from './config.js';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;
type LogMeta = Record<string, unknown>;

const currentLevel = LOG_LEVELS[config.logLevel] ?? LOG_LEVELS.info;

const getSafeReplacer = () => {
  const seen = new WeakSet();
  return (key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    if (typeof value === 'bigint') {
      return value.toString() + 'n';
    }
    return value;
  };
};

function formatMessage(level: LogLevel, message: string, meta: LogMeta = {}): string {
  const timestamp = new Date().toISOString();
  let metaStr = '';
  if (Object.keys(meta).length > 0) {
    try {
      metaStr = ` ${JSON.stringify(meta, getSafeReplacer())}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      metaStr = ` [unserializable meta: ${errorMessage}]`;
    }
  }
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

const logger = {
  error: (message: string, meta?: LogMeta) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, meta));
    }
  },

  warn: (message: string, meta?: LogMeta) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  info: (message: string, meta?: LogMeta) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(formatMessage('info', message, meta));
    }
  },

  debug: (message: string, meta?: LogMeta) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', message, meta));
    }
  },
};

export default logger;
