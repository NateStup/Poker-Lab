/**
 * HandLogRepository tests.
 *
 * The repository no longer wraps a `DataStore`, so there is no temp directory
 * to point it at any more -- it talks to Postgres directly, and these tests
 * do too. What they are really here for is the one property the route tests
 * can only observe second-hand: a hand that isn't yours does not exist as far
 * as this class is concerned, and that has to be true at the query level, not
 * at the layer above it.
 *
 * Isolation is by schema rather than by table. `postgresStore.test.js` gets a
 * throwaway table because `PostgresStore` is told its table name; this
 * repository writes `hands` into whatever schema it is pointed at, so the
 * equivalent knob one level up is `search_path` -- a throwaway schema holding
 * its own `users` and `hands`, created in `before` and dropped in `after`.
 * The real tables are never touched, which is the same guarantee, obtained
 * the only way this class leaves open.
 *
 * Skipped, not failed, when there is no reachable database, for the same
 * reason `postgresStore.test.js` is: `npm test` has to keep passing for a
 * contributor who hasn't started Docker.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import pg from 'pg';

import { createEmptyHand, validateHandLogRequest } from '../../src/shared/handLog/index.js';
import { HandLogRepository } from '../../src/server/store/HandLogRepository.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgres://pokerlab:pokerlab_dev@localhost:5432/pokerlab';

/** Unique per run, so two runs can overlap without colliding. */
const SCHEMA = `test_hands_${randomUUID().replace(/-/g, '')}`;

/**
 * Ask the database whether it is there, without hanging the suite if it isn't.
 * @returns {Promise<string|false>} a skip reason, or false if the database answered
 */
async function unreachableReason() {
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

/**
 * The shape `migrations/0002_users_and_ownership.sql` leaves behind, reduced
 * to the columns this repository actually reads and writes. A copy of the
 * migration's result rather than a run of the migration itself -- running it
 * would be testing the migration, and would own the real tables while doing it.
 */
const CREATE_TABLES = `
  CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE hands (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ,
    share_token TEXT UNIQUE
  );
`;

describe('HandLogRepository', { skip }, () => {
  /** @type {pg.Pool} */
  let adminPool;
  /** @type {pg.Pool} */
  let pool;
  /** @type {HandLogRepository} */
  let repository;
  /** @type {string} */
  let ownerId;
  /** @type {string} */
  let strangerId;

  /**
   * A validated hand, the same fixture shape the API tests use.
   * @param {object} [overrides]
   * @returns {object}
   */
  function buildHand(overrides = {}) {
    const { valid, errors, value } = validateHandLogRequest({
      ...createEmptyHand({ seatCount: 6 }),
      name: 'Aces cracked',
      ...overrides
    });
    assert.ok(valid, `test fixture must be valid: ${errors.join(' ')}`);
    return value;
  }

  /**
   * Insert an account directly rather than standing up a `UsersRepository`:
   * the foreign key wants a row, not an object, and one INSERT is less code
   * and one less class under test than the repository would be.
   * @returns {Promise<string>} the new user's id
   */
  async function createUser() {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
      [id, `${id}@example.test`, 'not-a-real-hash', 'Test Player']
    );
    return id;
  }

  before(async () => {
    adminPool = new pg.Pool({ connectionString: CONNECTION_STRING });
    await adminPool.query(`CREATE SCHEMA ${SCHEMA}`);

    // Every connection from this pool resolves an unqualified `hands` to the
    // throwaway schema, which is what lets the repository's own hard-coded
    // table names run against something disposable.
    pool = new pg.Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` });
    await pool.query(CREATE_TABLES);

    repository = new HandLogRepository(pool);
    await repository.init();

    ownerId = await createUser();
    strangerId = await createUser();
  });

  after(async () => {
    await pool?.end();
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await adminPool?.end();
  });

  // Every test below reads only rows it wrote itself. The users survive --
  // they are fixtures, not subjects -- and deleting the hands is enough to
  // keep one test's writes out of another's `listForOwner`.
  beforeEach(async () => {
    await pool.query('DELETE FROM hands');
  });

  it('stores a hand under the given owner, stamped with an id and timestamp', async () => {
    const hand = await repository.create(buildHand(), ownerId);

    assert.ok(hand.id, 'expected a generated id');
    assert.ok(hand.createdAt, 'expected a createdAt timestamp');
    assert.equal(hand.name, 'Aces cracked');
    // One record type, one shape: `create` returns through the same row
    // mapper every read here uses, so a freshly created hand carries the
    // `shareToken` key rather than leaving callers to tell `null` from
    // `undefined` depending on which method handed them the hand.
    assert.equal(hand.shareToken, null, 'a created hand is unshared, not missing the key');

    const { rows } = await pool.query('SELECT user_id, data FROM hands WHERE id = $1', [hand.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, ownerId, 'the owner is a column, not part of the blob');
    assert.equal(rows[0].data.name, 'Aces cracked');
    assert.equal(rows[0].data.id, undefined, 'id is a column, not a second copy inside data');
  });

  it('finds a hand for its owner', async () => {
    const created = await repository.create(buildHand({ name: 'Mine' }), ownerId);

    const found = await repository.findOwned(created.id, ownerId);
    assert.equal(found.id, created.id);
    assert.equal(found.name, 'Mine');
    assert.equal(found.shareToken, null, 'a hand is unshared until its owner says otherwise');
  });

  // The core security property of the whole rewrite: ownership is folded into
  // the query, so the wrong user asking for a real id gets the same answer as
  // anyone asking for an id that was never issued.
  it('does not find a real hand for the wrong owner', async () => {
    const created = await repository.create(buildHand(), ownerId);

    assert.equal(await repository.findOwned(created.id, strangerId), null);
    assert.equal(await repository.findOwned(randomUUID(), ownerId), null, 'and the same for an id that does not exist');
  });

  it('lists one owner\'s hands and not another\'s', async () => {
    await repository.create(buildHand({ name: 'Mine, older' }), ownerId);
    await repository.create(buildHand({ name: 'Mine, newer' }), ownerId);
    await repository.create(buildHand({ name: 'Theirs' }), strangerId);

    const page = await repository.listForOwner(ownerId);

    assert.equal(page.total, 2, 'the count is scoped to the owner, not the table');
    assert.deepEqual(page.items.map(hand => hand.name), ['Mine, newer', 'Mine, older']);

    const theirs = await repository.listForOwner(strangerId);
    assert.deepEqual(theirs.items.map(hand => hand.name), ['Theirs']);
  });

  it('pages a list without losing the owner scope', async () => {
    await repository.create(buildHand({ name: 'First' }), ownerId);
    await repository.create(buildHand({ name: 'Second' }), ownerId);
    await repository.create(buildHand({ name: 'Theirs' }), strangerId);

    const page = await repository.listForOwner(ownerId, { limit: 1, offset: 1 });

    assert.equal(page.items.length, 1);
    assert.equal(page.total, 2, 'the total counts every hand of theirs, not just this page');
    assert.equal(page.items[0].name, 'First', 'oldest of the two, since newest sorts first');
  });

  it('updates a hand for its owner, stamping updatedAt', async () => {
    const created = await repository.create(buildHand({ name: 'Before' }), ownerId);

    const updated = await repository.update(created.id, ownerId, buildHand({ name: 'After' }));

    assert.equal(updated.id, created.id, 'an edit keeps the id, so a link still resolves');
    assert.equal(updated.name, 'After');
    assert.ok(updated.updatedAt, 'an edited hand carries an updatedAt the created one did not');
  });

  it('does not update a hand for the wrong owner, and leaves it untouched', async () => {
    const created = await repository.create(buildHand({ name: 'Before' }), ownerId);

    assert.equal(await repository.update(created.id, strangerId, buildHand({ name: 'Hijacked' })), null);

    const found = await repository.findOwned(created.id, ownerId);
    assert.equal(found.name, 'Before', 'the write no-ops rather than partly applying');
    assert.equal(found.updatedAt, undefined);
  });

  it('removes a hand for its owner', async () => {
    const created = await repository.create(buildHand(), ownerId);

    assert.equal(await repository.remove(created.id, ownerId), true);
    assert.equal(await repository.findOwned(created.id, ownerId), null);
  });

  it('does not remove a hand for the wrong owner, and leaves it standing', async () => {
    const created = await repository.create(buildHand(), ownerId);

    assert.equal(await repository.remove(created.id, strangerId), false);
    assert.ok(await repository.findOwned(created.id, ownerId), 'still there for its owner');
  });

  it('serves a shared hand by token, with no owner involved at all', async () => {
    const created = await repository.create(buildHand({ name: 'Shared' }), ownerId);
    const token = 'a-token-for-this-test';

    const shared = await repository.setShareToken(created.id, ownerId, token);
    assert.equal(shared.shareToken, token);

    const found = await repository.findByShareToken(token);
    assert.equal(found.id, created.id);
    assert.equal(found.name, 'Shared');
  });

  it('stops serving a hand by token once the token is cleared', async () => {
    const created = await repository.create(buildHand(), ownerId);
    const token = 'a-token-to-be-revoked';
    await repository.setShareToken(created.id, ownerId, token);

    const revoked = await repository.setShareToken(created.id, ownerId, null);
    assert.equal(revoked.shareToken, null);

    assert.equal(await repository.findByShareToken(token), null);
    assert.ok(await repository.findOwned(created.id, ownerId), 'revoking the link leaves the hand itself alone');
  });

  it('does not share a hand on behalf of the wrong owner', async () => {
    const created = await repository.create(buildHand(), ownerId);

    assert.equal(await repository.setShareToken(created.id, strangerId, 'stolen-token'), null);
    assert.equal(await repository.findByShareToken('stolen-token'), null, 'no token was issued to look up');
  });

  it('finds nothing for a token that was never issued', async () => {
    await repository.create(buildHand(), ownerId);

    assert.equal(await repository.findByShareToken('never-issued'), null);
  });
});
