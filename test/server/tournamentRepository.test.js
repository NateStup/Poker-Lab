/**
 * TournamentRepository tests.
 *
 * Each test gets its own temp directory, same convention as `store.test.js`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { generateBlindStructure } from '../../src/shared/tournament/blindStructure.js';
import { JsonFileStore } from '../../src/server/store/JsonFileStore.js';
import { TournamentRepository } from '../../src/server/store/TournamentRepository.js';

/** @returns {object} settings good enough to create() with */
function baseSettings() {
  return {
    name: 'Friday night',
    startingStack: 10000,
    buyIn: 20,
    rebuyStack: 10000,
    rebuyAmount: 20,
    addOnStack: 15000,
    addOnAmount: 25,
    structure: generateBlindStructure({ levelCount: 4 }),
    payoutSplit: [50, 30, 20]
  };
}

describe('TournamentRepository', () => {
  let dir;
  let repository;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-tournaments-'));
    repository = new TournamentRepository(new JsonFileStore({ filePath: path.join(dir, 'tournaments.json') }));
    await repository.init();
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates a tournament in setup status with an empty roster and a paused clock', async () => {
    const tournament = await repository.create(baseSettings());

    assert.equal(tournament.status, 'setup');
    assert.deepEqual(tournament.players, []);
    assert.deepEqual(tournament.clock, { currentLevelIndex: 0, status: 'paused', levelStartedAt: null, pausedElapsedMs: 0 });
    assert.ok(tournament.id);
  });

  it('registers players', async () => {
    const tournament = await repository.create(baseSettings());
    const withAlice = await repository.registerPlayer(tournament.id, 'Alice');
    const withBob = await repository.registerPlayer(tournament.id, 'Bob');

    assert.equal(withAlice.players.length, 1);
    assert.equal(withAlice.players[0].name, 'Alice');
    assert.equal(withBob.players.length, 2);
    assert.equal(withBob.players[0].rebuys, 0);
    assert.equal(withBob.players[0].eliminated, false);
  });

  it('removes a registered player', async () => {
    const tournament = await repository.create(baseSettings());
    const withPlayer = await repository.registerPlayer(tournament.id, 'Carol');
    const playerId = withPlayer.players[0].id;

    const after1 = await repository.removePlayer(tournament.id, playerId);
    assert.deepEqual(after1.players, []);
  });

  it('records rebuys and add-ons', async () => {
    const tournament = await repository.create(baseSettings());
    const withPlayer = await repository.registerPlayer(tournament.id, 'Dave');
    const playerId = withPlayer.players[0].id;

    const afterRebuy = await repository.recordRebuy(tournament.id, playerId);
    assert.equal(afterRebuy.players[0].rebuys, 1);

    const afterAddOn = await repository.recordAddOn(tournament.id, playerId);
    assert.equal(afterAddOn.players[0].addOns, 1);
    assert.equal(afterAddOn.players[0].rebuys, 1, 'rebuy count must survive the add-on update');
  });

  it('assigns finishing places counting down from the field size on elimination', async () => {
    let tournament = await repository.create(baseSettings());
    tournament = await repository.registerPlayer(tournament.id, 'P1');
    tournament = await repository.registerPlayer(tournament.id, 'P2');
    tournament = await repository.registerPlayer(tournament.id, 'P3');
    const [p1, p2, p3] = tournament.players;

    // First elimination out of 3 entrants gets last place (3rd).
    tournament = await repository.eliminatePlayer(tournament.id, p1.id);
    assert.equal(tournament.players.find(p => p.id === p1.id).place, 3);
    assert.equal(tournament.status, 'setup', 'the tournament is not decided yet');

    // Second elimination leaves exactly one player: the tournament auto-completes
    // and the survivor is awarded first place.
    tournament = await repository.eliminatePlayer(tournament.id, p2.id);
    assert.equal(tournament.players.find(p => p.id === p2.id).place, 2);
    assert.equal(tournament.status, 'completed');
    assert.equal(tournament.players.find(p => p.id === p3.id).place, 1);
  });

  it('reinstates an eliminated player and un-completes the tournament', async () => {
    let tournament = await repository.create(baseSettings());
    tournament = await repository.registerPlayer(tournament.id, 'X');
    tournament = await repository.registerPlayer(tournament.id, 'Y');
    tournament = await repository.registerPlayer(tournament.id, 'Z');
    const [x, y, z] = tournament.players;

    tournament = await repository.startClock(tournament.id); // simulate an active tournament
    tournament = await repository.eliminatePlayer(tournament.id, x.id);
    assert.equal(tournament.status, 'active', 'two players remain; not decided yet');

    tournament = await repository.eliminatePlayer(tournament.id, y.id);
    assert.equal(tournament.status, 'completed');
    assert.equal(tournament.players.find(p => p.id === z.id).place, 1);

    tournament = await repository.reinstatePlayer(tournament.id, y.id);
    assert.equal(tournament.status, 'active');
    const reinstated = tournament.players.find(p => p.id === y.id);
    assert.equal(reinstated.eliminated, false);
    assert.equal(reinstated.place, null);
  });

  it('drives the clock through start, pause, resume, and advance', async () => {
    let tournament = await repository.create(baseSettings());

    tournament = await repository.startClock(tournament.id);
    assert.equal(tournament.status, 'active');
    assert.equal(tournament.clock.status, 'running');
    assert.ok(tournament.clock.levelStartedAt);

    tournament = await repository.pauseClock(tournament.id);
    assert.equal(tournament.clock.status, 'paused');
    assert.equal(tournament.clock.levelStartedAt, null);
    assert.ok(tournament.clock.pausedElapsedMs >= 0);

    tournament = await repository.resumeClock(tournament.id);
    assert.equal(tournament.clock.status, 'running');

    tournament = await repository.advanceLevel(tournament.id);
    assert.equal(tournament.clock.currentLevelIndex, 1);
    assert.equal(tournament.clock.pausedElapsedMs, 0, 'advancing resets the in-level clock');
  });

  it('does not advance past the last level', async () => {
    let tournament = await repository.create({ ...baseSettings(), structure: generateBlindStructure({ levelCount: 2 }) });
    tournament = await repository.startClock(tournament.id);
    tournament = await repository.advanceLevel(tournament.id);
    tournament = await repository.advanceLevel(tournament.id);

    assert.equal(tournament.clock.currentLevelIndex, 1);
  });

  it('jumps directly to a level via setLevel', async () => {
    let tournament = await repository.create(baseSettings());
    tournament = await repository.setLevel(tournament.id, 2);
    assert.equal(tournament.clock.currentLevelIndex, 2);
  });
});
