/**
 * PostgresStore tests.
 *
 * The same assertions `store.test.js` makes about `JsonFileStore`, made against
 * the other implementation of the same interface -- that is the point of them.
 * A store swap is only safe if both stores answer the same questions the same
 * way, and the only way to know that is to ask both.
 *
 * Each run gets its own throwaway table, created in `before` and dropped in
 * `after`, so this never touches the real `history`/`tournaments`/`hands`
 * tables and two runs can overlap without colliding.
 *
 * Skipped, not failed, when there is no reachable database: `npm test` has to
 * keep passing for a contributor who hasn't started Docker, so the connection
 * is probed once at module load and the whole file skips with a reason if it
 * doesn't answer.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import pg from 'pg';

import { PostgresStore } from '../../src/server/store/postgres/PostgresStore.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgres://pokerlab:pokerlab_dev@localhost:5432/pokerlab';

/** Unique per run, and a legal identifier -- `PostgresStore` rejects anything else. */
const TABLE = `test_store_${randomUUID().replace(/-/g, '')}`;

/**
 * Ask the database whether it is there, without hanging the suite if it isn't.
 * @returns {Promise<string|false>} a skip reason, or false if the database answered
 */
async function unreachableReason() {
  // A short connect timeout is the whole point: the default leaves this to the
  // OS, which is quick against a closed port and very slow against a host that
  // simply never answers.
  const probe = new pg.Pool({ connectionString: CONNECTION_STRING, connectionTimeoutMillis: 2000 });
  try {
    await probe.query('SELECT 1');
    return false;
  } catch (error) {
    return `no database reachable (${error.code || error.message})`;
  } finally {
    await probe.end().catch(() => {});
  }
}

const skip = await unreachableReason();

/** The shape `migrations/0001_init.sql` gives every real collection. */
const CREATE_TABLE = table => `
  CREATE TABLE ${table} (
    id UUID PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
  )
`;

describe('PostgresStore', { skip }, () => {
  /** @type {pg.Pool} */
  let pool;
  /** @type {PostgresStore} */
  let store;

  before(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    // A copy of the migration's shape rather than a run of the migration
    // itself: running it would test the migration, and would own the real
    // tables while doing it.
    await pool.query(CREATE_TABLE(TABLE));
    store = new PostgresStore({ pool, tableName: TABLE });
    await store.init();
  });

  after(async () => {
    await pool?.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool?.end();
  });

  // Every test below reads only rows it wrote itself. Without this, a test's
  // assertions quietly depend on which tests ran before it -- and `list()`
  // orders by `created_at`, so a leftover row stamped with the current time
  // sorts *newer* than any fixture date, which is exactly how the ordering
  // and pagination tests came to be asserting something that was never true.
  beforeEach(async () => {
    await store.clear();
  });

  // Renamed from 'starts empty when the table has just been created': under
  // the hook above this runs against a cleared table, not a fresh one, and
  // those are different claims. Table creation is covered by `before` failing.
  it('reports zero for an empty table', async () => {
    assert.equal(await store.count(), 0);
  });

  it('stamps inserted records with an id and timestamp', async () => {
    const record = await store.insert({ type: 'equity', label: 'first' });

    assert.ok(record.id, 'expected a generated id');
    assert.ok(record.createdAt, 'expected a createdAt timestamp');
    assert.equal(record.label, 'first');
  });

  it('writes the record through to the table', async () => {
    await store.insert({ type: 'equity', label: 'written-through' });

    const { rows } = await pool.query(`SELECT id, data FROM ${TABLE}`);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].data.label, 'written-through', 'everything but the columns lives in data');
    assert.equal(rows[0].data.id, undefined, 'id is a column, not a second copy inside data');
  });

  /**
   * Three rows whose order is stated by the data, not inferred from the order
   * the tests happen to run in. Both properties matter: `created_at` is what
   * this store orders by, so a row stamped with the current time (any insert
   * that doesn't pass one) is *newer* than a 2024 date no matter when it was
   * written -- and two inserts landing in the same millisecond tie, where an
   * in-memory array would fall back on insertion order.
   * @returns {Promise<void>}
   */
  async function seedThreeDatedRecords() {
    await store.insert({ type: 'equity', label: 'first', createdAt: '2024-01-01T00:00:00.000Z' });
    await store.insert({ type: 'equity', label: 'second', createdAt: '2024-01-02T00:00:00.000Z' });
    await store.insert({ type: 'equity', label: 'third', createdAt: '2024-01-03T00:00:00.000Z' });
  }

  it('returns records newest first', async () => {
    await seedThreeDatedRecords();

    const page = await store.list({ limit: 10 });

    assert.deepEqual(page.items.map(item => item.label), ['third', 'second', 'first']);
    assert.equal(page.total, 3);
  });

  it('paginates', async () => {
    await seedThreeDatedRecords();

    const page = await store.list({ limit: 1, offset: 1 });

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].label, 'second');
  });

  it('filters on field equality', async () => {
    await store.insert({ type: 'simulation', label: 'sim' });
    await store.insert({ type: 'equity', label: 'not-a-sim' });

    const page = await store.list({ where: { type: 'simulation' } });

    assert.equal(page.total, 1, 'total must count the filtered set, not the whole table');
    assert.equal(page.items[0].label, 'sim');
  });

  it('refuses a filter field that is not a safe identifier', async () => {
    const injected = { [`type' OR '1'='1`]: 'x' };
    await assert.rejects(() => store.list({ where: injected }), /Unsafe filter field/);
  });

  it('updates a record via an updater function', async () => {
    const inserted = await store.insert({ type: 'equity', label: 'mutable', count: 1 });

    const updated = await store.update(inserted.id, current => ({ count: current.count + 1 }));

    assert.equal(updated.count, 2);
    assert.equal(updated.id, inserted.id);
    assert.equal(updated.createdAt, inserted.createdAt, 'update must not touch createdAt');
    assert.ok(updated.updatedAt, 'expected an updatedAt timestamp');
    assert.equal((await store.findById(inserted.id)).count, 2, 'the change must be persisted');
  });

  it('returns null when updating an id that does not exist', async () => {
    assert.equal(await store.update(randomUUID(), record => record), null);
  });

  it('finds and removes by id', async () => {
    const inserted = await store.insert({ type: 'equity', label: 'removable' });

    assert.equal((await store.findById(inserted.id)).label, 'removable');
    assert.equal(await store.remove(inserted.id), true);
    assert.equal(await store.findById(inserted.id), null);
    assert.equal(await store.remove(randomUUID()), false);
  });

  it('clears every record', async () => {
    for (const label of ['a', 'b', 'c']) await store.insert({ type: 'equity', label });

    const removed = await store.clear();

    assert.equal(removed, 3, 'clear() reports how many rows it actually deleted');
    assert.equal(await store.count(), 0);
  });
});

describe('PostgresStore durability', { skip }, () => {
  /** @type {pg.Pool} */
  let pool;
  const table = `${TABLE}_durability`;

  before(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    await pool.query(CREATE_TABLE(table));
  });

  after(async () => {
    await pool?.query(`DROP TABLE IF EXISTS ${table}`);
    await pool?.end();
  });

  // Clearing between tests does *not* weaken what this block proves. The
  // persistence being tested is entirely within each test -- one instance
  // writes and a second one reads, both constructed here -- so nothing
  // crosses a test boundary except the rows themselves, which are the only
  // reason `total === 1` below was ever true. Raw SQL rather than
  // `store.clear()`: this block's subject is what survives an instance, so
  // its fixture shouldn't be routed through one.
  beforeEach(async () => {
    await pool.query(`DELETE FROM ${table}`);
  });

  it('reads records written by a previous instance', async () => {
    const first = new PostgresStore({ pool, tableName: table });
    await first.insert({ label: 'persisted' });
    await first.close();

    const second = new PostgresStore({ pool, tableName: table });
    const page = await second.list();

    assert.equal(page.total, 1);
    assert.equal(page.items[0].label, 'persisted');
  });

  it('serialises concurrent updates to one record instead of losing them', async () => {
    // The Postgres counterpart of JsonFileStore's concurrent-write test. There
    // the guarantee falls out of being single-threaded; here it comes from
    // SELECT ... FOR UPDATE, and a lost update shows as a count below 25.
    const store = new PostgresStore({ pool, tableName: table });
    const { id } = await store.insert({ label: 'contended', count: 0 });

    await Promise.all(
      Array.from({ length: 25 }, () => store.update(id, current => ({ count: current.count + 1 })))
    );

    assert.equal((await store.findById(id)).count, 25);
  });

  it('rejects an unsafe table name at construction', () => {
    assert.throws(
      () => new PostgresStore({ pool, tableName: 'hands; DROP TABLE hands' }),
      /Unsafe table name/
    );
  });

  it('fails loudly on init() when the table has not been migrated', async () => {
    const missing = new PostgresStore({ pool, tableName: 'table_that_was_never_migrated' });
    await assert.rejects(() => missing.init(), /table_that_was_never_migrated/);
  });
});
