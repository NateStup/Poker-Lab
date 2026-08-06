/**
 * HandLogRepository tests.
 *
 * Each test gets its own temp directory, same convention as `store.test.js`
 * and `tournamentRepository.test.js`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createEmptyHand, validateHandLogRequest } from '../../src/shared/handLog/index.js';
import { HandLogRepository } from '../../src/server/store/HandLogRepository.js';
import { JsonFileStore } from '../../src/server/store/JsonFileStore.js';

/** @param {object} [overrides] @returns {object} a validated hand ready to store */
function buildHand(overrides = {}) {
  const { valid, errors, value } = validateHandLogRequest({
    ...createEmptyHand({ seatCount: 6 }),
    name: 'Aces cracked',
    ...overrides
  });
  assert.ok(valid, `test fixture must be valid: ${errors.join(' ')}`);
  return value;
}

describe('HandLogRepository', () => {
  let dir;
  let repository;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-hands-'));
    repository = new HandLogRepository(new JsonFileStore({ filePath: path.join(dir, 'hands.json') }));
    await repository.init();
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores a hand and stamps it with an id and timestamp', async () => {
    const hand = await repository.create(buildHand());

    assert.ok(hand.id);
    assert.ok(hand.createdAt);
    assert.equal(hand.name, 'Aces cracked');
    assert.equal(hand.seats.length, 6);
  });

  it('reads a stored hand back by id', async () => {
    const created = await repository.create(buildHand({ name: 'Findable' }));
    const found = await repository.findById(created.id);

    assert.equal(found.name, 'Findable');
    assert.deepEqual(found.streets.preflop.actions, []);
  });

  it('returns null for an unknown id', async () => {
    assert.equal(await repository.findById('not-a-real-id'), null);
  });

  it('lists hands newest first', async () => {
    const isolated = new HandLogRepository(new JsonFileStore({ filePath: path.join(dir, 'listing.json') }));
    await isolated.init();

    await isolated.create(buildHand({ name: 'First' }));
    await isolated.create(buildHand({ name: 'Second' }));

    const page = await isolated.list({ limit: 10 });
    assert.equal(page.total, 2);
    assert.equal(page.items[0].name, 'Second', 'newest first');
  });

  it('replaces a hand wholesale on update, keeping id and createdAt', async () => {
    const created = await repository.create(buildHand({ name: 'Before edit' }));

    const edited = await repository.update(created.id, buildHand({
      name: 'After edit',
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 0, type: 'raise', amount: 6 }], notes: 'opened' },
        flop: { board: ['As', 'Kd', '7h'], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));

    assert.equal(edited.id, created.id, 'an edit must not mint a new id -- shared links point at it');
    assert.equal(edited.createdAt, created.createdAt);
    assert.ok(edited.updatedAt);
    assert.equal(edited.name, 'After edit');
    assert.deepEqual(edited.streets.flop.board, ['As', 'Kd', '7h']);
    assert.equal(edited.streets.preflop.notes, 'opened');
  });

  it('deletes a hand', async () => {
    const created = await repository.create(buildHand({ name: 'Deletable' }));

    assert.equal(await repository.remove(created.id), true);
    assert.equal(await repository.findById(created.id), null);
    assert.equal(await repository.remove(created.id), false, 'deleting twice is not an error, just a miss');
  });

  it('survives a reload from disk', async () => {
    const filePath = path.join(dir, 'durable.json');
    const first = new HandLogRepository(new JsonFileStore({ filePath }));
    await first.init();
    const created = await first.create(buildHand({ name: 'Persisted' }));
    await first.store.close();

    const second = new HandLogRepository(new JsonFileStore({ filePath }));
    await second.init();
    const found = await second.findById(created.id);

    assert.equal(found.name, 'Persisted');
  });
});
