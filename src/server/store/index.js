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
import { TournamentRepository } from './TournamentRepository.js';

export { DataStore } from './DataStore.js';
export { HandLogRepository } from './HandLogRepository.js';
export { HistoryRepository, RECORD_TYPES } from './HistoryRepository.js';
export { JsonFileStore } from './JsonFileStore.js';
export { PostgresStore } from './postgres/PostgresStore.js';
export { TournamentRepository } from './TournamentRepository.js';

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
 * Build and initialise the hand-log repository.
 *
 * Deliberately uncapped, unlike history: a saved hand is something the user
 * deliberately named and kept, so silently evicting the oldest ones the way
 * `maxHistoryRecords` does to auto-recorded calculations would be data loss.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir] overrides the configured data directory --
 *   tests pass a temp directory so they never touch real data; ignored under
 *   the `postgres` driver
 * @returns {Promise<HandLogRepository>}
 */
export async function createHandLogRepository({ dataDir } = {}) {
  const store = config.db.driver === 'postgres'
    ? new PostgresStore({ pool: getPool(), tableName: 'hands' })
    : new JsonFileStore({
        filePath: path.join(dataDir || config.paths.data, 'hands.json'),
        writeDebounceMs: config.store.writeDebounceMs
      });

  const repository = new HandLogRepository(store);
  await repository.init();
  return repository;
}
