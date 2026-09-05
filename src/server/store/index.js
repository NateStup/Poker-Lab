/**
 * Store wiring.
 *
 * The single place that decides *which* {@link DataStore} implementation backs
 * the app. There are two now -- `JsonFileStore` over a file per collection, and
 * `PostgresStore` over a table per collection -- and `config.db.driver` picks
 * between them here, once, for all three repositories. Nothing upstream knows
 * which one it got: a repository takes a `DataStore`, and both satisfy it.
 */

import path from 'node:path';

import { config } from '../config.js';
import { HandLogRepository } from './HandLogRepository.js';
import { HistoryRepository } from './HistoryRepository.js';
import { JsonFileStore } from './JsonFileStore.js';
import { PostgresStore } from './postgres/PostgresStore.js';
import { getPool } from './postgres/pool.js';
import { SessionsRepository } from './SessionsRepository.js';
import { TournamentRepository } from './TournamentRepository.js';
import { UsersRepository } from './UsersRepository.js';

export { DataStore } from './DataStore.js';
export { HandLogRepository } from './HandLogRepository.js';
export { HistoryRepository, RECORD_TYPES } from './HistoryRepository.js';
export { JsonFileStore } from './JsonFileStore.js';
export { PostgresStore } from './postgres/PostgresStore.js';
export { SessionsRepository } from './SessionsRepository.js';
export { TournamentRepository } from './TournamentRepository.js';
export { EmailAlreadyRegisteredError, UsersRepository } from './UsersRepository.js';

/**
 * Build and initialise the history repository.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir] overrides the configured data directory --
 *   tests pass a temp directory so they never touch real history. Meaningful
 *   only under the `json` driver; Postgres has no directory to point at, so
 *   it is ignored there rather than treated as an error
 * @returns {Promise<HistoryRepository>}
 */
export async function createHistoryRepository({ dataDir } = {}) {
  const store = config.db.driver === 'postgres'
    ? new PostgresStore({ pool: getPool(), tableName: 'history' })
    : new JsonFileStore({
        filePath: path.join(dataDir || config.paths.data, 'history.json'),
        maxRecords: config.store.maxHistoryRecords,
        writeDebounceMs: config.store.writeDebounceMs
      });

  const repository = new HistoryRepository(store);
  await repository.init();
  return repository;
}

/**
 * Build and initialise the tournament repository.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir] overrides the configured data directory --
 *   tests pass a temp directory so they never touch real data; ignored under
 *   the `postgres` driver
 * @returns {Promise<TournamentRepository>}
 */
export async function createTournamentRepository({ dataDir } = {}) {
  const store = config.db.driver === 'postgres'
    ? new PostgresStore({ pool: getPool(), tableName: 'tournaments' })
    : new JsonFileStore({
        filePath: path.join(dataDir || config.paths.data, 'tournaments.json'),
        writeDebounceMs: config.store.writeDebounceMs
      });

  const repository = new TournamentRepository(store);
  await repository.init();
  return repository;
}

/**
 * Build and initialise the hand-log repository. Postgres-only: a hand now
 * carries real ownership and an optional share token, neither of which a
 * JSON file has any way to model. `STORE_DRIVER=json` is only ever meant
 * as a fallback for environments without Docker, and there is no honest "hand
 * logging with no accounts" mode to fall back to any more.
 *
 * @returns {Promise<HandLogRepository>}
 */
export async function createHandLogRepository() {
  if (config.db.driver !== 'postgres') {
    throw new Error(
      'The hand logger requires Postgres -- it stores real ownership and ' +
      'share links, which a JSON file cannot represent. Unset STORE_DRIVER ' +
      '(or set it to "postgres") to run this app.'
    );
  }

  const repository = new HandLogRepository(getPool());
  await repository.init();
  return repository;
}

/**
 * Build the users repository.
 *
 * Postgres-only and synchronous, unlike the three above: there is no generic
 * `DataStore` underneath to initialise, and no JSON-file equivalent of an
 * account -- `users` exists to be joined against, which is the one thing a
 * JSONB envelope has nothing to offer.
 *
 * @returns {UsersRepository}
 */
export function createUsersRepository() {
  return new UsersRepository(getPool());
}

/**
 * Build the sessions repository. Same shape, and the same reasoning, as
 * {@link createUsersRepository}.
 *
 * @returns {SessionsRepository}
 */
export function createSessionsRepository() {
  return new SessionsRepository({ pool: getPool(), ttlMs: config.auth.sessionTtlMs });
}
