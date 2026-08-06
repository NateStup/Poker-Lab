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
 * Stop accepting connections, then flush every store before exiting. Without
 * the flush, a debounced write could be lost on Ctrl+C -- and every store is
 * debounced, so they all have to be closed, not just the first one.
 * @param {string} signal
 */
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down.`);

  server.close(() => console.log('HTTP server closed.'));

  const stores = [
    app.locals.historyRepository,
    app.locals.tournamentRepository,
    app.locals.handLogRepository
  ];

  for (const repository of stores) {
    try {
      await repository?.store?.close();
    } catch (error) {
      console.error('Failed to flush a data store:', error.message);
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
