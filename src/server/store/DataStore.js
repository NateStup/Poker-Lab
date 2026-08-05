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
