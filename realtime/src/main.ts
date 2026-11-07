import { createServer } from './server.js';
import { PORT } from './config.js';

console.log(`Starting NextDocs Yhub Realtime Server on port ${PORT}...`);
createServer()
  .then(() => {
    console.log(`NextDocs Yhub Realtime Server running on port ${PORT}`);
  })
  .catch((err) => {
    console.error('Failed to start realtime server:', err);
    process.exit(1);
  });
