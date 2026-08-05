/**
 * Store wiring.
 *
 * The single place that decides *which* {@link DataStore} implementation backs
 * the app. Swapping the JSON files for a database means adding one class and
 * editing {@link createHistoryRepository} -- nothing upstream changes.
 */

import path from 'node:path';

import { config } from '../config.js';
import { HistoryRepository } from './HistoryRepository.js';
import { JsonFileStore } from './JsonFileStore.js';

export { DataStore } from './DataStore.js';
export { HistoryRepository, RECORD_TYPES } from './HistoryRepository.js';
export { JsonFileStore } from './JsonFileStore.js';

/**
 * Build and initialise the history repository.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir] overrides the configured data directory --
 *   tests pass a temp directory so they never touch real history
 * @returns {Promise<HistoryRepository>}
 */
export async function createHistoryRepository({ dataDir } = {}) {
  const store = new JsonFileStore({
    filePath: path.join(dataDir || config.paths.data, 'history.json'),
    maxRecords: config.store.maxHistoryRecords,
    writeDebounceMs: config.store.writeDebounceMs
  });

  const repository = new HistoryRepository(store);
  await repository.init();
  return repository;
}
