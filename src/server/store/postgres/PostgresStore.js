/**
 * A Postgres-backed collection store, matching the `DataStore` contract.
 *
 * Each instance owns one table (`history`, `tournaments`, `hands` today),
 * mirroring how one `JsonFileStore` instance owned one file. A record's `id`,
 * `createdAt` and `updatedAt` are real columns -- "newest first" is a
 * `created_at` index instead of reversing an in-memory array -- and
 * everything else about the record lives in a JSONB `data` column, since
 * these collections have no fixed shape yet worth modelling as real columns.
 * (`hands` gets that treatment once accounts exist; see `migrations/`.)
 *
 * `where` is a plain object of field-equals-value pairs (`{ type: 'equity' }`),
 * not a JavaScript predicate the way `JsonFileStore` used to accept -- a
 * closure cannot become a `WHERE` clause, so `DataStore`'s interface was
 * narrowed to the one shape both stores can actually implement. Field names
 * are validated against a strict identifier pattern before being interpolated
 * into the query string, because `pg`'s `$1`-style parameters bind *values*,
 * never column or JSON-key names -- there is no placeholder for "the name of
 * a field", so this is the one place in the store layer that builds SQL by
 * concatenation rather than by parameter, and it only ever does so with a
 * value this module has itself validated.
 */

import { randomUUID } from 'node:crypto';

import { DataStore } from '../DataStore.js';

/** A JSONB key or table name has to look like this to be interpolated into a query. */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class PostgresStore extends DataStore {
  /**
   * @param {object} options
   * @param {import('pg').Pool} options.pool
   * @param {string} options.tableName must match {@link SAFE_IDENTIFIER}; the
   *   table is assumed to already exist (see `npm run db:migrate`)
   */
  constructor({ pool, tableName }) {
    super();
    if (!SAFE_IDENTIFIER.test(tableName)) {
      throw new Error(`Unsafe table name: ${tableName}`);
    }
    this.pool = pool;
    this.tableName = tableName;
  }

  /**
   * There's no connection to open here -- the pool is shared and already
   * live -- but every other store's `init()` is where "ready to use" gets
   * confirmed, so this confirms it the same way: one query that fails loudly
   * if the table this instance was configured for doesn't exist yet, rather
   * than deferring that discovery to the first real `insert()` in production.
   * @returns {Promise<this>}
   */
  async init() {
    await this.pool.query(`SELECT 1 FROM ${this.tableName} LIMIT 1`);
    return this;
  }

  /**
   * @param {object} record
   * @returns {Promise<object>} the stored record, including generated fields
   */
  async insert(record) {
    const id = record.id || randomUUID();
    const createdAt = record.createdAt || new Date().toISOString();
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = record;

    await this.pool.query(
      `INSERT INTO ${this.tableName} (id, data, created_at) VALUES ($1, $2, $3)`,
      [id, JSON.stringify(rest), createdAt]
    );

    return { id, createdAt, ...rest };
  }

  /**
   * Read-modify-write a single record inside a transaction, with `SELECT ...
   * FOR UPDATE` locking the row for its duration. That is the Postgres
   * equivalent of the guarantee `JsonFileStore.update` gets for free from
   * being single-threaded: a concurrent `update()` on the same id waits for
   * this one to finish rather than racing it and losing a write.
   *
   * @param {string} id
   * @param {(current: object) => object} updater receives the current record,
   *   returns the fields to merge over it
   * @returns {Promise<object|null>} the updated record, or `null` if `id` doesn't exist
   */
  async update(id, updater) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, data, created_at, updated_at FROM ${this.tableName} WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const current = rowToRecord(rows[0]);
      const updatedAt = new Date().toISOString();
      const merged = {
        ...current,
        ...updater(current),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt
      };
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = merged;

      await client.query(
        `UPDATE ${this.tableName} SET data = $2, updated_at = $3 WHERE id = $1`,
        [id, JSON.stringify(rest), updatedAt]
      );

      await client.query('COMMIT');
      return merged;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Read records, newest first.
   * @param {{limit?: number, offset?: number, where?: Record<string, unknown>}} [query]
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit = 50, offset = 0, where } = {}) {
    const { clause, values } = buildWhereClause(where);

    const { rows } = await this.pool.query(
      `SELECT id, data, created_at, updated_at FROM ${this.tableName} ${clause}
       ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    const { rows: countRows } = await this.pool.query(
      `SELECT count(*)::int AS total FROM ${this.tableName} ${clause}`,
      values
    );

    return { items: rows.map(rowToRecord), total: countRows[0].total, limit, offset };
  }

  /** @param {string} id @returns {Promise<object|null>} */
  async findById(id) {
    const { rows } = await this.pool.query(
      `SELECT id, data, created_at, updated_at FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return rows.length ? rowToRecord(rows[0]) : null;
  }

  /** @param {string} id @returns {Promise<boolean>} true if a record was removed */
  async remove(id) {
    const { rowCount } = await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
    return rowCount > 0;
  }

  /** @returns {Promise<number>} how many records were removed */
  async clear() {
    const { rows } = await this.pool.query(`DELETE FROM ${this.tableName} RETURNING id`);
    return rows.length;
  }

  /** @returns {Promise<number>} */
  async count() {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS total FROM ${this.tableName}`);
    return rows[0].total;
  }

  /**
   * Nothing to close per-instance -- the pool is shared across every
   * `PostgresStore` and is closed once, centrally, on process shutdown (see
   * `closePool` in `postgres/pool.js`, wired into `server.js`).
   * @returns {Promise<void>}
   */
  async close() {}
}

/**
 * @param {{id: string, data: object, created_at: Date, updated_at: Date|null}} row
 * @returns {object}
 */
function rowToRecord(row) {
  const record = { id: row.id, createdAt: row.created_at.toISOString(), ...row.data };
  if (row.updated_at) record.updatedAt = row.updated_at.toISOString();
  return record;
}

/**
 * @param {Record<string, unknown>} [where]
 * @returns {{clause: string, values: unknown[]}}
 */
function buildWhereClause(where) {
  const entries = Object.entries(where || {});
  if (entries.length === 0) return { clause: '', values: [] };

  const conditions = entries.map(([field], index) => {
    if (!SAFE_IDENTIFIER.test(field)) throw new Error(`Unsafe filter field: ${field}`);
    // ->> extracts the JSONB value as text, since every value this store has
    // ever filtered on (a record's `type`) is a plain string.
    return `data ->> '${field}' = $${index + 1}`;
  });

  return { clause: `WHERE ${conditions.join(' AND ')}`, values: entries.map(([, value]) => value) };
}
