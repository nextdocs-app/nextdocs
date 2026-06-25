import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config.js';
import logger from './logger.js';
import { server, wss, cleanupInactiveRooms } from './server.js';

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const currentPath = fs.realpathSync(path.resolve(fileURLToPath(import.meta.url)));
    const entryPath = fs.realpathSync(path.resolve(process.argv[1]));
    return currentPath === entryPath;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const cleanupInterval = setInterval(cleanupInactiveRooms, config.roomCleanupInterval);

  function shutdown(signal: string): void {
    logger.info('Shutdown signal received', { signal });

    clearInterval(cleanupInterval);

    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });

    server.close(() => {
      logger.info('Server closed successfully');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error('Unhandled rejection', { reason, promise });
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info('NextDocs Realtime Server started', {
      host: config.host,
      port: config.port,
      corsOrigins: config.corsOrigins,
      nodeVersion: process.version,
    });
    logger.info('Health check available at /health');
    logger.info('Metrics available at /metrics');
  });
}
