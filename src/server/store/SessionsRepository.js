/**
 * Domain-level access to sessions.
 *
 * A session's `id` doubles as the bearer token: it's what gets signed into
 * the cookie, and there is no separate secret to look one up by, the same
 * way a hand's `share_token` is itself the capability rather than a key to
 * one. It needs more entropy than a UUID's 122 random bits offer, since
 * unlike a hand id -- which nothing is ever guessing at over the network on
 * purpose -- a session id is exactly what an attacker would try to guess.
 */

import { randomBytes } from 'node:crypto';

export class SessionsRepository {
  /**
   * @param {object} options
   * @param {import('pg').Pool} options.pool
   * @param {number} options.ttlMs how long a newly created session lasts
   */
  constructor({ pool, ttlMs }) {
    this.pool = pool;
    this.ttlMs = ttlMs;
  }

  /**
   * @param {string} userId
   * @returns {Promise<{id: string, userId: string, expiresAt: Date}>}
   */
  async create(userId) {
    const id = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [
      id,
      userId,
      expiresAt
    ]);

    return { id, userId, expiresAt };
  }

  /**
   * A session past its `expires_at` is treated identically to one that was
   * never created -- the query itself excludes it, rather than returning a
   * row for a caller to remember to check the expiry on.
   * @param {string} id
   * @returns {Promise<{id: string, userId: string}|null>}
   */
  async findValid(id) {
    const { rows } = await this.pool.query(
      'SELECT id, user_id FROM sessions WHERE id = $1 AND expires_at > now()',
      [id]
    );
    return rows.length ? { id: rows[0].id, userId: rows[0].user_id } : null;
  }

  /**
   * @param {string} id
   * @returns {Promise<void>}
   */
  async destroy(id) {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id]);
  }
}
