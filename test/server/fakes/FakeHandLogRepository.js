/**
 * An in-memory stand-in for HandLogRepository. Replicates the one behaviour
 * HandLogService's policy actually depends on: every read and write is
 * scoped to (id, userId) together, so a hand that isn't the caller's reports
 * a miss identically to a hand that doesn't exist at all -- there is no way
 * for a caller of this fake to tell those two cases apart, same as the real
 * SQL WHERE clause.
 *
 * Two things beyond a plain map are here specifically for HandLogService's
 * write-race tests, and exist nowhere in the real repository:
 *
 * - `calls`, an ordered log of method names. `HandLogService` was written so
 *   that `share`/`unshare`/`remove` are each a single repository statement
 *   with no ownership pre-read (the real `UPDATE ... WHERE id = $1 AND
 *   user_id = $2` already folds that check in) -- `calls` is what lets a test
 *   prove that stayed true, rather than trusting the source doesn't regress.
 * - `runBeforeNext(methodName, callback)`, which fires `callback` immediately
 *   before the next call to `methodName`. Nothing in single-threaded
 *   JavaScript can otherwise interleave with this fake's own methods, so this
 *   is how a test recreates "the row was there when a read looked, and gone
 *   by the time the write ran" -- the exact race `HandLogService.update`
 *   still has a window for (it has to read the record before it can merge a
 *   patch over it), and the one HandLogService's write-result checks exist to
 *   survive.
 */

import { randomUUID } from 'node:crypto';

export class FakeHandLogRepository {
  constructor() {
    /** @type {Map<string, object>} keyed by hand id; each row also carries userId/shareToken */
    this.byId = new Map();
    /** @type {string[]} method names, in call order */
    this.calls = [];
    /** @type {Map<string, Array<() => void>>} one-shot hooks, per method name */
    this.hooksBeforeNext = new Map();
  }

  /**
   * Run `callback` immediately before the next call to `methodName`, then
   * discard it. See the class doc for what this is for.
   * @param {string} methodName
   * @param {() => void} callback
   */
  runBeforeNext(methodName, callback) {
    const queue = this.hooksBeforeNext.get(methodName) ?? [];
    queue.push(callback);
    this.hooksBeforeNext.set(methodName, queue);
  }

  /** @param {string} methodName */
  #record(methodName) {
    this.calls.push(methodName);
    const queue = this.hooksBeforeNext.get(methodName);
    if (queue?.length) queue.shift()();
  }

  /**
   * @param {object} hand
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async create(hand, userId) {
    this.#record('create');
    const id = randomUUID();
    const row = { ...hand, id, userId, createdAt: new Date().toISOString(), shareToken: null };
    this.byId.set(id, row);
    return toHand(row);
  }

  /**
   * @param {string} userId
   * @param {{limit?: number, offset?: number}} [query]
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async listForOwner(userId, { limit = 50, offset = 0 } = {}) {
    this.#record('listForOwner');
    const owned = [...this.byId.values()]
      .filter(row => row.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { items: owned.slice(offset, offset + limit).map(toHand), total: owned.length, limit, offset };
  }

  /** @param {string} id @param {string} userId @returns {Promise<object|null>} */
  async findOwned(id, userId) {
    this.#record('findOwned');
    const row = this.byId.get(id);
    return row && row.userId === userId ? toHand(row) : null;
  }

  /** @param {string} token @returns {Promise<object|null>} */
  async findByShareToken(token) {
    this.#record('findByShareToken');
    for (const row of this.byId.values()) {
      if (row.shareToken === token) return toHand(row);
    }
    return null;
  }

  /** @param {string} id @param {string} userId @param {object} hand @returns {Promise<object|null>} */
  async update(id, userId, hand) {
    this.#record('update');
    const row = this.byId.get(id);
    if (!row || row.userId !== userId) return null;

    const updated = { ...row, ...hand, id, userId, updatedAt: new Date().toISOString() };
    this.byId.set(id, updated);
    return toHand(updated);
  }

  /** @param {string} id @param {string} userId @returns {Promise<boolean>} */
  async remove(id, userId) {
    this.#record('remove');
    const row = this.byId.get(id);
    if (!row || row.userId !== userId) return false;
    this.byId.delete(id);
    return true;
  }

  /** @param {string} id @param {string} userId @param {string|null} token @returns {Promise<object|null>} */
  async setShareToken(id, userId, token) {
    this.#record('setShareToken');
    const row = this.byId.get(id);
    if (!row || row.userId !== userId) return null;

    const updated = { ...row, shareToken: token };
    this.byId.set(id, updated);
    return toHand(updated);
  }
}

/** @param {object} row @returns {object} strips userId, the fake's own bookkeeping field */
function toHand(row) {
  const { userId: _userId, ...hand } = row;
  return { ...hand };
}
