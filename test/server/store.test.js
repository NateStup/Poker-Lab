/**
 * Data store tests.
 *
 * Each test gets its own temp directory so nothing touches the real `data/`
 * directory and the suite can run in parallel.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { HistoryRepository } from '../../src/server/store/HistoryRepository.js';
import { JsonFileStore } from '../../src/server/store/JsonFileStore.js';
import { DataStore } from '../../src/server/store/DataStore.js';

/** @returns {Promise<string>} a fresh temp directory */
async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'poker-store-'));
}

describe('DataStore', () => {
  it('forces subclasses to implement the contract', async () => {
    const store = new DataStore();
    await assert.rejects(() => store.init(), /must implement init/);
    await assert.rejects(() => store.insert({}), /must implement insert/);
    await assert.rejects(() => store.list(), /must implement list/);
    await assert.rejects(() => store.update('id', record => record), /must implement update/);
  });
});

describe('JsonFileStore', () => {
  let dir;
  let store;

  before(async () => {
    dir = await makeTempDir();
    store = new JsonFileStore({ filePath: path.join(dir, 'history.json') });
    await store.init();
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty when there is no backing file', async () => {
    assert.equal(await store.count(), 0);
  });

  it('stamps inserted records with an id and timestamp', async () => {
    const record = await store.insert({ type: 'equity', label: 'first' });

    assert.ok(record.id, 'expected a generated id');
    assert.ok(record.createdAt, 'expected a createdAt timestamp');
    assert.equal(record.label, 'first');
  });

  it('writes the record through to disk', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'history.json'), 'utf8'));
    assert.equal(raw.records.length, 1);
    assert.equal(raw.version, 1);
  });

  it('returns records newest first', async () => {
    await store.insert({ type: 'equity', label: 'second' });
    await store.insert({ type: 'equity', label: 'third' });

    const page = await store.list({ limit: 10 });
    assert.deepEqual(page.items.map(item => item.label), ['third', 'second', 'first']);
    assert.equal(page.total, 3);
  });

  it('paginates', async () => {
    const page = await store.list({ limit: 1, offset: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].label, 'second');
  });

  it('filters with a predicate', async () => {
    await store.insert({ type: 'simulation', label: 'sim' });
    const page = await store.list({ where: record => record.type === 'simulation' });

    assert.equal(page.total, 1);
    assert.equal(page.items[0].label, 'sim');
  });

  it('updates a record via an updater function', async () => {
    const inserted = await store.insert({ type: 'equity', label: 'mutable', count: 1 });

    const updated = await store.update(inserted.id, current => ({ count: current.count + 1 }));

    assert.equal(updated.count, 2);
    assert.equal(updated.id, inserted.id);
    assert.equal(updated.createdAt, inserted.createdAt, 'update must not touch createdAt');
    assert.ok(updated.updatedAt, 'expected an updatedAt timestamp');
    assert.equal((await store.findById(inserted.id)).count, 2, 'the change must be persisted in memory');
  });

  it('returns null when updating an id that does not exist', async () => {
    assert.equal(await store.update('does-not-exist', record => record), null);
  });

  it('finds and removes by id', async () => {
    const inserted = await store.insert({ type: 'equity', label: 'removable' });

    assert.equal((await store.findById(inserted.id)).label, 'removable');
    assert.equal(await store.remove(inserted.id), true);
    assert.equal(await store.findById(inserted.id), null);
    assert.equal(await store.remove('does-not-exist'), false);
  });

  it('clears every record', async () => {
    const removed = await store.clear();
    assert.ok(removed > 0);
    assert.equal(await store.count(), 0);
  });
});

describe('JsonFileStore durability', () => {
  it('reloads records written by a previous instance', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'history.json');

    const first = new JsonFileStore({ filePath });
    await first.insert({ label: 'persisted' });
    await first.close();

    const second = new JsonFileStore({ filePath });
    const page = await second.list();

    assert.equal(page.total, 1);
    assert.equal(page.items[0].label, 'persisted');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('evicts the oldest records once maxRecords is exceeded', async () => {
    const dir = await makeTempDir();
    const store = new JsonFileStore({ filePath: path.join(dir, 'history.json'), maxRecords: 3 });

    for (const label of ['a', 'b', 'c', 'd', 'e']) {
      await store.insert({ label });
    }

    const page = await store.list();
    assert.equal(page.total, 3);
    assert.deepEqual(page.items.map(item => item.label), ['e', 'd', 'c']);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('quarantines a corrupt file instead of crashing', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'history.json');
    await fs.writeFile(filePath, '{ this is not valid json', 'utf8');

    const store = new JsonFileStore({ filePath });
    assert.equal(await store.count(), 0, 'a corrupt file should yield an empty store');

    const quarantined = await fs.readFile(`${filePath}.corrupt`, 'utf8');
    assert.match(quarantined, /not valid json/);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('serialises concurrent writes without losing records', async () => {
    const dir = await makeTempDir();
    const store = new JsonFileStore({ filePath: path.join(dir, 'history.json') });

    await Promise.all(
      Array.from({ length: 25 }, (_, i) => store.insert({ label: `concurrent-${i}` }))
    );
    await store.close();

    const reloaded = new JsonFileStore({ filePath: path.join(dir, 'history.json') });
    assert.equal(await reloaded.count(), 25);

    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('HistoryRepository', () => {
  let dir;
  let repository;

  before(async () => {
    dir = await makeTempDir();
    repository = new HistoryRepository(
      new JsonFileStore({ filePath: path.join(dir, 'history.json') })
    );
    await repository.init();
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores the inputs and the seed alongside the numbers', async () => {
    const record = await repository.recordEquityCalculation({
      request: {
        players: [['As', 'Ah'], ['Kd', 'Kc']],
        board: [],
        dead: [],
        iterations: 1000
      },
      result: {
        players: [
          { index: 0, cards: ['As', 'Ah'], equity: 0.82, win: 0.81, tie: 0.01 },
          { index: 1, cards: ['Kd', 'Kc'], equity: 0.18, win: 0.17, tie: 0.01 }
        ],
        board: [],
        method: 'monte-carlo',
        iterations: 1000,
        seed: 42,
        durationMs: 15
      }
    });

    assert.equal(record.type, 'equity');
    assert.equal(record.result.seed, 42, 'the seed must survive so the run can be replayed');
    assert.deepEqual(record.request.players, [['As', 'Ah'], ['Kd', 'Kc']]);
  });

  it('derives a readable label when none is supplied', async () => {
    const page = await repository.list();
    assert.match(page.items[0].label, /AsAh vs KdKc \(preflop\)/);
  });

  it('honours an explicit label', async () => {
    const record = await repository.recordEquityCalculation({
      label: 'Cooler on a wet flop',
      request: { players: [['As', 'Ah'], ['Kd', 'Kc']], board: ['2c', '7d', '9h'], dead: [] },
      result: {
        players: [
          { index: 0, cards: ['As', 'Ah'], equity: 0.9, win: 0.9, tie: 0 },
          { index: 1, cards: ['Kd', 'Kc'], equity: 0.1, win: 0.1, tie: 0 }
        ],
        board: ['2c', '7d', '9h'],
        method: 'exact',
        iterations: 990,
        seed: null,
        durationMs: 40
      }
    });

    assert.equal(record.label, 'Cooler on a wet flop');
  });

  it('reports aggregate stats', async () => {
    const stats = await repository.stats();
    assert.equal(stats.total, 2);
    assert.equal(stats.byType.equity, 2);
  });
});
