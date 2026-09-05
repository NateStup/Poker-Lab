/**
 * Runtime configuration, resolved once from the environment.
 *
 * Every tunable the server reads lives here so there is a single place to look
 * when deploying, and so no module reaches into `process.env` directly.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile } from './loadEnv.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, derived from this file's location rather than `process.cwd()`. */
export const ROOT_DIR = path.resolve(here, '..', '..');

// Before the literal below, because every value in it reads `process.env` as
// this module is evaluated. Top-level code here runs synchronously and this
// module is the only reader of the environment, so one call in one place is
// the whole of it -- no import order to get right elsewhere.
loadEnvFile(ROOT_DIR);

export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  paths: Object.freeze({
    root: ROOT_DIR,
    public: path.join(ROOT_DIR, 'public'),
    /** Served to the browser so the client can import the domain modules directly. */
    shared: path.join(ROOT_DIR, 'src', 'shared'),
    data: process.env.DATA_DIR || path.join(ROOT_DIR, 'data')
  }),

  store: Object.freeze({
    /** Records retained per collection; oldest are dropped once exceeded. */
    maxHistoryRecords: Number.parseInt(process.env.MAX_HISTORY_RECORDS || '500', 10),
    /** Milliseconds to batch writes before flushing to disk. */
    writeDebounceMs: Number.parseInt(process.env.WRITE_DEBOUNCE_MS || '50', 10)
  }),

  db: Object.freeze({
    url: process.env.DATABASE_URL || 'postgres://pokerlab:pokerlab_dev@localhost:5432/pokerlab',
    /** 'json' keeps the current file-backed store; 'postgres' switches every
     *  collection created through store/index.js to PostgresStore. Defaulting
     *  to 'postgres' now that the plumbing exists -- set STORE_DRIVER=json to
     *  fall back without touching code. */
    driver: process.env.STORE_DRIVER || 'postgres'
  }),

  auth: Object.freeze({
    /** Signs the session cookie. The literal fallback is fine for local dev,
     *  where anyone reading it already has full access to the machine; it
     *  must never be the value in anything reachable from outside localhost. */
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-session-secret',
    sessionTtlMs: Number.parseInt(process.env.SESSION_TTL_MS || String(30 * 24 * 60 * 60 * 1000), 10)
  }),

  logging: Object.freeze({
    /** morgan format; `dev` is noisy but useful locally, `combined` suits deployment. */
    format: process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'combined' : 'dev')
  })
});

// Runs once, at import time, the same way `loadEnvFile` above does -- a
// process that would sign session cookies with the publicly-known default
// should fail to start, not serve forgeable sessions until someone notices.
if (config.env === 'production' && !process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET must be set in production -- refusing to sign session ' +
    'cookies with the publicly-known development default.'
  );
}

/** @returns {boolean} true when running outside production */
export function isDevelopment() {
  return config.env !== 'production';
}
