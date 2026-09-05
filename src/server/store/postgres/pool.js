/**
 * The shared Postgres connection pool.
 *
 * One pool per process, not one client per query: opening a TCP connection to
 * Postgres costs real time, so `pg.Pool` keeps a small set of them open and
 * hands one to whichever query is running. That is what makes `pool.query()`
 * cheap to call from anywhere in the store layer.
 *
 * Nothing here is collection-specific -- `PostgresStore` is what turns a pool
 * into a `DataStore`. This module's only job is the connection itself.
 */

import pg from 'pg';

import { config } from '../../config.js';

const { Pool } = pg;

/** @type {pg.Pool|null} */
let pool = null;

/**
 * The process-wide pool, created on first use.
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.db.url });

    // A connection that dies while sitting idle in the pool -- the database
    // restarting, a network blip -- would otherwise surface as an unhandled
    // 'error' event and crash the process. Postgres recovers the next query
    // onto a fresh connection on its own; logging here is only visibility.
    pool.on('error', error => {
      console.error('[db] idle client error:', error.message);
    });
  }
  return pool;
}

/**
 * Close every connection in the pool. Called on graceful shutdown so the
 * process can exit instead of being held open by idle sockets.
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
