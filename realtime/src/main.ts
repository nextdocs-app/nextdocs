import { createServer } from './server.js';
import { PORT } from './config.js';
import { installShutdownHandlers } from './shutdown.js';

console.log(`Starting NextDocs Yhub Realtime Server on port ${PORT}...`);
createServer()
  .then((server) => {
    console.log(`NextDocs Yhub Realtime Server running on port ${PORT}`);
    // Installed after startup so a signal during boot still takes the default path;
    // once serving, SIGTERM must drain rather than drop every socket.
    installShutdownHandlers(server);
  })
  .catch((err) => {
    console.error('Failed to start realtime server:', err);
    process.exit(1);
  });
