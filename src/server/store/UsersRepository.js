/**
 * Domain-level access to accounts.
 *
 * Talks to Postgres directly, the same call `HandLogRepository` now makes --
 * `users` exists to be looked up by a unique email and joined against by
 * `hands` and `sessions`, which a JSONB envelope through the generic
 * `DataStore` has nothing to offer. There is no JSON-file equivalent of this
 * repository and there never will be; accounts are a Postgres-only feature
 * of this app from here on.
 */

import { randomUUID } from 'node:crypto';

/** Thrown by `create` when the email is already registered; callers translate this to a client-safe error. */
export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('That email is already registered.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

export class UsersRepository {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * @param {{email: string, passwordHash: string, displayName: string}} account
   * @returns {Promise<{id: string, email: string, displayName: string, createdAt: string}>}
   */
  async create({ email, passwordHash, displayName }) {
    const id = randomUUID();
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (id, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, display_name, created_at`,
        [id, normalizedEmail, passwordHash, displayName]
      );
      return toPublicUser(rows[0]);
    } catch (error) {
      // 23505 is Postgres's unique_violation -- the one column with a UNIQUE
      // constraint here is email, so there's nothing else this could be.
      if (error.code === '23505') throw new EmailAlreadyRegisteredError();
      throw error;
    }
  }

  /**
   * Includes the password hash, unlike every other lookup here -- this is the
   * one path that exists specifically to check a password, and `AuthService`
   * is responsible for never letting the hash leak past that check.
   * @param {string} email
   * @returns {Promise<{id: string, email: string, displayName: string, createdAt: string, passwordHash: string}|null>}
   */
  async findByEmailWithPasswordHash(email) {
    const { rows } = await this.pool.query(
      'SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    if (rows.length === 0) return null;
    return { ...toPublicUser(rows[0]), passwordHash: rows[0].password_hash };
  }

  /**
   * @param {string} id
   * @returns {Promise<{id: string, email: string, displayName: string, createdAt: string}|null>}
   */
  async findById(id) {
    const { rows } = await this.pool.query(
      'SELECT id, email, display_name, created_at FROM users WHERE id = $1',
      [id]
    );
    return rows.length ? toPublicUser(rows[0]) : null;
  }
}

/**
 * @param {{id: string, email: string, display_name: string, created_at: Date}} row
 * @returns {{id: string, email: string, displayName: string, createdAt: string}}
 */
function toPublicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at.toISOString() };
}
