/**
 * Domain-level access to saved hands.
 *
 * No longer wraps the generic `DataStore` the way `HistoryRepository` and
 * `TournamentRepository` still do -- `hands` is the one collection with a
 * real relationship to model (an owner) and a real capability to check (a
 * share token), and a JSONB envelope through a generic store has no way to
 * express "this field is a real column, not part of the blob." Talking to
 * Postgres directly here is the same shift `PostgresStore` itself earned
 * over `JsonFileStore`, applied one layer up: general-purpose storage for
 * `history`/`tournaments`, purpose-built storage for the one collection that
 * actually needs it.
 *
 * Every read and write that isn't the public share-view path takes a
 * `userId` and folds it into the query itself (`WHERE id = $1 AND user_id =
 * $2`), rather than fetching a row first and checking ownership in
 * JavaScript afterward -- a hand that isn't the caller's doesn't exist as
 * far as any of these methods are concerned, which is what makes "not
 * found" the honest response rather than a deliberately vague one.
 */

import { randomUUID } from 'node:crypto';

const SELECT_COLUMNS = 'id, data, created_at, updated_at, share_token';

export class HandLogRepository {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    this.pool = pool;
  }

  /** @returns {Promise<this>} */
  async init() {
    await this.pool.query('SELECT 1 FROM hands LIMIT 1');
    return this;
  }

  /**
   * @param {object} hand a validated hand (see `validateHandLogRequest`)
   * @param {string} userId
   * @returns {Promise<object>} the stored hand
   */
  async create(hand, userId) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    await this.pool.query(
      'INSERT INTO hands (id, user_id, data, created_at) VALUES ($1, $2, $3, $4)',
      [id, userId, JSON.stringify(hand), createdAt]
    );

    return { id, createdAt, ...hand };
  }

  /**
   * @param {string} userId
   * @param {{limit?: number, offset?: number}} [query]
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async listForOwner(userId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM hands
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const { rows: countRows } = await this.pool.query(
      'SELECT count(*)::int AS total FROM hands WHERE user_id = $1',
      [userId]
    );

    return { items: rows.map(rowToHand), total: countRows[0].total, limit, offset };
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object|null>} `null` if the hand doesn't exist *or* isn't this user's
   */
  async findOwned(id, userId) {
    const { rows } = await this.#queryOrMiss(
      `SELECT ${SELECT_COLUMNS} FROM hands WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return rows.length ? rowToHand(rows[0]) : null;
  }

  /**
   * The public, unauthenticated read path -- looked up by `share_token`
   * alone, deliberately never by `id`. Whether a token was never issued or
   * was revoked, the answer here is identical: nothing found.
   * @param {string} token
   * @returns {Promise<object|null>}
   */
  async findByShareToken(token) {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM hands WHERE share_token = $1`,
      [token]
    );
    return rows.length ? rowToHand(rows[0]) : null;
  }

  /**
   * Replace a hand's content wholesale, scoped to its owner in the same
   * query rather than checked beforehand -- an `UPDATE ... WHERE id = $1 AND
   * user_id = $2` either touches exactly the caller's own row or touches
   * nothing; there's no separate check-then-write step for a concurrent
   * request to land in between.
   * @param {string} id
   * @param {string} userId
   * @param {object} hand
   * @returns {Promise<object|null>}
   */
  async update(id, userId, hand) {
    const updatedAt = new Date().toISOString();
    const { rows } = await this.#queryOrMiss(
      `UPDATE hands SET data = $3, updated_at = $4
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_COLUMNS}`,
      [id, userId, JSON.stringify(hand), updatedAt]
    );
    return rows.length ? rowToHand(rows[0]) : null;
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async remove(id, userId) {
    const { rowCount } = await this.#queryOrMiss('DELETE FROM hands WHERE id = $1 AND user_id = $2', [id, userId]);
    return rowCount > 0;
  }

  /**
   * Set or clear the share token. Passing `null` revokes -- the hand itself
   * is untouched, only the capability to view it without being its owner.
   * @param {string} id
   * @param {string} userId
   * @param {string|null} token
   * @returns {Promise<object|null>}
   */
  async setShareToken(id, userId, token) {
    const { rows } = await this.#queryOrMiss(
      `UPDATE hands SET share_token = $3
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_COLUMNS}`,
      [id, userId, token]
    );
    return rows.length ? rowToHand(rows[0]) : null;
  }

  /**
   * Postgres raises 22P02 (invalid_text_representation) when a parameter can't
   * parse as a uuid -- which is exactly what happens for a caller-supplied id
   * that was never real to begin with. That's "no such hand," the same as a
   * well-formed id matching nothing, so this treats the two identically rather
   * than letting a malformed id surface as a 500.
   * @param {string} query
   * @param {unknown[]} params
   * @returns {Promise<{rows: object[], rowCount: number}>}
   */
  async #queryOrMiss(query, params) {
    try {
      return await this.pool.query(query, params);
    } catch (error) {
      if (error.code === '22P02') return { rows: [], rowCount: 0 };
      throw error;
    }
  }
}

/**
 * @param {{id: string, data: object, created_at: Date, updated_at: Date|null, share_token: string|null}} row
 * @returns {object}
 */
function rowToHand(row) {
  const hand = { id: row.id, createdAt: row.created_at.toISOString(), ...row.data };
  if (row.updated_at) hand.updatedAt = row.updated_at.toISOString();
  hand.shareToken = row.share_token || null;
  return hand;
}
