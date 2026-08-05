/**
 * The persistence contract every store implementation must satisfy.
 *
 * Services depend on this shape, never on a concrete store, so moving from
 * JSON files to a real database is a one-class change. The base class throws
 * on every method: a subclass that forgets one fails loudly the first time it
 * is exercised rather than silently returning `undefined`.
 */

export class DataStore {
  /**
   * Prepare the store for use (open files, connect, run migrations).
   * @returns {Promise<this>}
   */
  async init() {
    throw new Error(`${this.constructor.name} must implement init()`);
  }

  /**
   * Persist a new record.
   * @param {object} _record
   * @returns {Promise<object>} the stored record with any generated fields
   */
  async insert(_record) {
    throw new Error(`${this.constructor.name} must implement insert()`);
  }

  /**
   * Read a page of records, newest first.
   * @param {{limit?: number, offset?: number, where?: (record: object) => boolean}} [_query]
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list(_query) {
    throw new Error(`${this.constructor.name} must implement list()`);
  }

  /**
   * @param {string} _id
   * @returns {Promise<object|null>}
   */
  async findById(_id) {
    throw new Error(`${this.constructor.name} must implement findById()`);
  }

  /**
   * Read-modify-write a single record. `HistoryRepository` never needed this
   * (a calculation result is immutable once stored), but a tournament's
   * player roster, clock, and blind level all change after creation, so its
   * repository needs a way to mutate one record without racing a concurrent
   * write to the same file -- that's why this takes an updater function
   * rather than a replacement value; the implementation applies it against
   * whatever the current stored value is, not whatever the caller last read.
   *
   * @param {string} _id
   * @param {(current: object) => object} _updater receives the current record,
   *   returns the fields to merge over it
   * @returns {Promise<object|null>} the updated record, or `null` if `_id` doesn't exist
   */
  async update(_id, _updater) {
    throw new Error(`${this.constructor.name} must implement update()`);
  }

  /**
   * @param {string} _id
   * @returns {Promise<boolean>} whether a record was removed
   */
  async remove(_id) {
    throw new Error(`${this.constructor.name} must implement remove()`);
  }

  /**
   * @returns {Promise<number>} how many records were removed
   */
  async clear() {
    throw new Error(`${this.constructor.name} must implement clear()`);
  }

  /**
   * @returns {Promise<number>}
   */
  async count() {
    throw new Error(`${this.constructor.name} must implement count()`);
  }

  /**
   * Release resources and ensure pending writes are durable.
   * @returns {Promise<void>}
   */
  async close() {
    // Nothing to release by default.
  }
}
