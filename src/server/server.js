#!/usr/bin/env node
/**
 * Process entry point.
 *
 * Responsible only for lifecycle: build the app, bind the port, report clearly
 * on failure, and shut down without losing buffered writes. Application wiring
 * belongs in `app.js`.
 */

import http from 'node:http';

import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
const server = http.createServer(app);

server.listen(config.port, config.host);

server.on('listening', () => {
  const address = server.address();
  const bind = typeof address === 'string' ? address : `port ${address.port}`;
  console.log(`Poker Lab listening on ${bind} (${config.env})`);
  console.log(`  http://localhost:${config.port}`);
});

server.on('error', error => {
  if (error.syscall !== 'listen') throw error;

  switch (error.code) {
    case 'EACCES':
      console.error(`Port ${config.port} requires elevated privileges.`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`Port ${config.port} is already in use. Set PORT to choose another.`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

/**
 * Stop accepting connections, then flush the store before exiting. Without the
 * flush, a debounced history write could be lost on Ctrl+C.
 * @param {string} signal
 */
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down.`);

  server.close(() => console.log('HTTP server closed.'));

  try {
    await app.locals.historyRepository?.store?.close();
  } catch (error) {
    console.error('Failed to flush the data store:', error.message);
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
