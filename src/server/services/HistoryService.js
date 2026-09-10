/**
 * Application service for reading and managing the calculation history.
 *
 * Until now `historyRoutes.js` talked to `HistoryRepository` directly -- there
 * was nothing to decide, just storage to read and write. Ownership changes
 * that: a route now has to answer "is this caller allowed to see/touch this
 * record", and that's a service-layer decision everywhere else in this app
 * (`TournamentService#assertAccessible`, the hand logger's ownership checks),
 * not something a route or a storage-facing repository should be deciding for
 * itself. This mirrors `TournamentService`'s `#require`/`#assertAccessible`
 * shape, including its exact accessibility rule: a record with no owner is
 * open to anyone, one with an owner is only readable/removable by that owner,
 * and "not yours" and "doesn't exist" are deliberately the same 404.
 *
 * Writing a record stays outside this service -- `EquityService` already owns
 * that (the "persist and swallow" path where a storage failure must not fail
 * the calculation itself), and there's no reason to route a write through a
 * second class just to reach the same repository.
 */

import { ApiError } from '../errors/ApiError.js';

export class HistoryService {
  /** @param {{historyRepository: import('../store/HistoryRepository.js').HistoryRepository}} deps */
  constructor({ historyRepository }) {
    this.repository = historyRepository;
  }

  /**
   * Newest-first page of the caller's own history. There is no unscoped mode
   * any more -- the route requires a session before this ever runs, but this
   * still refuses to guess what an empty `userId` should mean rather than
   * silently listing nothing (or everything).
   * @param {{limit?: number, offset?: number, type?: string}} query
   * @param {string|undefined} userId
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit, offset, type } = {}, userId) {
    if (!userId) throw ApiError.unauthorized('Log in to see your history.');
    return this.repository.list({ limit, offset, type, userId });
  }

  /**
   * @param {string|undefined} userId
   * @returns {Promise<{total: number, byType: Record<string, number>}>}
   */
  async stats(userId) {
    if (!userId) throw ApiError.unauthorized('Log in to see your history.');
    return this.repository.stats({ userId });
  }

  /**
   * @param {string} id
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async get(id, userId) {
    const record = await this.#require(id);
    this.#assertAccessible(record, userId);
    return record;
  }

  /**
   * @param {string} id
   * @param {string|undefined} userId
   * @returns {Promise<boolean>}
   */
  async remove(id, userId) {
    const record = await this.#require(id);
    this.#assertAccessible(record, userId);
    return this.repository.remove(id);
  }

  /**
   * Delete only the caller's own records. "Clear all" stopped meaning "wipe
   * the table" the moment records could have an owner -- an anonymous
   * record, or another account's, has to survive a call this caller makes.
   * @param {string|undefined} userId
   * @returns {Promise<number>} how many records were removed
   */
  async clear(userId) {
    if (!userId) throw ApiError.unauthorized('Log in to clear your history.');
    return this.repository.clearOwnedBy(userId);
  }

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async #require(id) {
    const record = await this.repository.findById(id);
    if (!record) throw ApiError.notFound(`No history record with id ${id}`);
    return record;
  }

  /**
   * A record with no owner (every calculation run anonymously) is open to
   * anyone, exactly as it was before accounts existed. One with an owner can
   * only be read or removed by that owner -- 404, not 403, for everyone else
   * including no session at all, since confirming an owned record's
   * existence to someone who can't touch it is its own leak.
   * @param {object} record
   * @param {string|undefined} userId
   * @throws {ApiError} 404 if the record has an owner and it isn't this caller
   */
  #assertAccessible(record, userId) {
    if (record.userId && record.userId !== userId) {
      throw ApiError.notFound(`No history record with id ${record.id}`);
    }
  }
}
