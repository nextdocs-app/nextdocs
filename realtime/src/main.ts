import { createServer } from './server.js';
import { PORT } from './config.js';
import { log } from './logger.js';
import { installShutdownHandlers } from './shutdown.js';

log.info(`Starting NextDocs Yhub Realtime Server on port ${PORT}...`);
createServer()
  .then((server) => {
    log.info(`NextDocs Yhub Realtime Server running on port ${PORT}`);
    // Installed after startup so a signal during boot still takes the default path;
    // once serving, SIGTERM must drain rather than drop every socket.
    installShutdownHandlers(server);
  })
  .catch((err) => {
    log.error('Failed to start realtime server:', err);
    process.exit(1);
  });
