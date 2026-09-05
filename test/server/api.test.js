/**
 * End-to-end API tests.
 *
 * The app is booted on an ephemeral port with a repository backed by a temp
 * directory, then driven with the global `fetch`. That exercises the real
 * middleware stack -- body parsing, routing, error handling -- without pulling
 * in a test-only HTTP client dependency.
 *
 * Hands are the exception to the temp directory: they carry real ownership
 * now, so their repository is Postgres-backed and the `/api/hands` block
 * needs a live database. It skips with a reason when there isn't one, the
 * same way `postgresStore.test.js` does, so `npm test` still passes for
 * someone who hasn't started Docker. History and tournaments are untouched
 * and keep running either way.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import pg from 'pg';

import { createApp } from '../../src/server/app.js';
import { createEmptyHand } from '../../src/shared/handLog/index.js';
import { HandLogRepository } from '../../src/server/store/HandLogRepository.js';
import { HistoryRepository } from '../../src/server/store/HistoryRepository.js';
import { JsonFileStore } from '../../src/server/store/JsonFileStore.js';
import { closePool, getPool } from '../../src/server/store/postgres/pool.js';
import { TournamentRepository } from '../../src/server/store/TournamentRepository.js';

let server;
let baseUrl;
let tempDir;
/** Accounts the hand-log tests create, torn down by that block's `after`. */
const createdUserIds = [];
/** Row counts before the hand-log block ran, so its teardown is checked
 *  against the database it was actually handed rather than an assumed-empty
 *  one -- a developer's rows are not this suite's to have opinions about. */
let handTablesBaseline;

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgres://pokerlab:pokerlab_dev@localhost:5432/pokerlab';

/**
 * Ask the database whether it is there, without hanging the suite if it isn't.
 * Same probe, and the same short timeout for the same reason, as
 * `postgresStore.test.js`.
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

const dbSkip = await unreachableReason();

/**
 * @param {string} pathname
 * @param {RequestInit} [options]
 * @returns {Promise<{status: number, body: any}>}
 */
async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/**
 * Row counts for the three tables the hand-log tests write to. Compared
 * before and after that block, never asserted to be any particular number --
 * a developer's database is not this suite's to have opinions about.
 * @returns {Promise<{users: number, sessions: number, hands: number}>}
 */
async function tableCounts() {
  const { rows } = await getPool().query(
    `SELECT (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM sessions) AS sessions,
            (SELECT count(*)::int FROM hands) AS hands`
  );
  return rows[0];
}

/**
 * A `fetch` that remembers cookies, which is all "logged in" means here: the
 * session is an httpOnly cookie the server sets and the browser carries back.
 * A test HTTP client's `agent()` is the usual way to get this, and this
 * project deliberately has none -- carrying one header forward is a dozen
 * lines, which is the trade this codebase makes everywhere else too.
 *
 * Each call to this returns an independent jar, so two of them are two
 * unrelated browsers, which is exactly what the cross-account tests need.
 * @returns {(pathname: string, options?: RequestInit) => Promise<{status: number, body: any}>}
 */
function browser() {
  /** @type {Map<string, string>} */
  const jar = new Map();

  return async function request(pathname, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (jar.size > 0) headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });

    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      // An empty value is `res.clearCookie` -- logging out has to actually
      // forget the session, not carry a dead cookie forward as if it were one.
      if (value) jar.set(name, value);
      else jar.delete(name);
    }

    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-api-'));

  const historyRepository = new HistoryRepository(
    new JsonFileStore({ filePath: path.join(tempDir, 'history.json') })
  );
  await historyRepository.init();

  const tournamentRepository = new TournamentRepository(
    new JsonFileStore({ filePath: path.join(tempDir, 'tournaments.json') })
  );
  await tournamentRepository.init();

  // Postgres-backed, not a temp file: a hand has an owner and a share token
  // now, and neither is something a JSON file can hold. `init()` is the call
  // that touches the database, so it is the one thing skipped when there
  // isn't one -- the constructor itself opens nothing, which lets `createApp`
  // succeed and every non-hand test below run as it always has.
  const handLogRepository = new HandLogRepository(getPool());
  if (!dbSkip) await handLogRepository.init();

  const app = await createApp({ historyRepository, tournamentRepository, handLogRepository });
  server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
  // The accounts themselves are torn down by the hand-log block's own
  // `after`, which then proves the teardown worked -- this hook only has to
  // outlive it, so the deletes still have a pool to run on.
  await closePool();
});


describe('GET /api/health', () => {
  it('reports that the server is up', async () => {
    const { status, body } = await api('/api/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
});

describe('POST /api/equity', () => {
  it('calculates equity for a valid spot', async () => {
    const { status, body } = await api('/api/equity', {
      method: 'POST',
      body: JSON.stringify({
        players: [['As', 'Ah'], ['Kd', 'Kc']],
        board: ['2c', '7d', '9h']
      })
    });

    assert.equal(status, 200);
    assert.equal(body.method, 'exact');
    assert.equal(body.players.length, 2);
    assert.ok(body.players[0].equity > body.players[1].equity, 'aces should be ahead');
    assert.ok(body.historyId, 'the result should be recorded in history');
  });

  it('honours a seed so a sampled run can be replayed', async () => {
    const payload = JSON.stringify({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      iterations: 1000,
      seed: 'fixed'
    });

    const first = await api('/api/equity', { method: 'POST', body: payload });
    const second = await api('/api/equity', { method: 'POST', body: payload });

    assert.equal(first.body.players[0].equity, second.body.players[0].equity);
  });

  it('rejects a request with too few players', async () => {
    const { status, body } = await api('/api/equity', {
      method: 'POST',
      body: JSON.stringify({ players: [['As', 'Ah']] })
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
    assert.ok(body.error.details.length > 0);
  });

  it('rejects a duplicated card and says which one', async () => {
    const { status, body } = await api('/api/equity', {
      method: 'POST',
      body: JSON.stringify({ players: [['As', 'Ah'], ['As', 'Kc']] })
    });

    assert.equal(status, 400);
    assert.ok(body.error.details.some(detail => detail.includes('As')));
  });

  it('rejects a malformed JSON body', async () => {
    const response = await fetch(`${baseUrl}/api/equity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json'
    });

    assert.equal(response.status, 400);
  });
});

describe('POST /api/ranges/equity', () => {
  it('calculates equity for a range against a specific hand', async () => {
    const { status, body } = await api('/api/ranges/equity', {
      method: 'POST',
      body: JSON.stringify({
        heroRange: ['AA'],
        villain: { cards: ['Kd', 'Kc'] },
        iterations: 2000,
        seed: 'api-test'
      })
    });

    assert.equal(status, 200);
    assert.equal(body.method, 'sampled');
    assert.ok(body.hero.equity > body.villain.equity, 'aces should be ahead of kings');
    assert.equal(body.villain.comboCount, 1);
  });

  it('calculates equity for a range against a range', async () => {
    const { status, body } = await api('/api/ranges/equity', {
      method: 'POST',
      body: JSON.stringify({
        heroRange: ['AA', 'KK'],
        villain: { hands: ['QQ', 'JJ'] },
        iterations: 2000,
        seed: 'api-test-range'
      })
    });

    assert.equal(status, 200);
    assert.equal(body.hero.comboCount, 12);
    assert.equal(body.villain.comboCount, 12);
    assert.ok(Math.abs(body.hero.equity + body.villain.equity - 1) < 1e-9);
  });

  it('honours a seed so a run can be replayed', async () => {
    const payload = JSON.stringify({
      heroRange: ['AKs', 'AKo'],
      villain: { hands: ['QQ'] },
      iterations: 1500,
      seed: 'fixed-range'
    });

    const first = await api('/api/ranges/equity', { method: 'POST', body: payload });
    const second = await api('/api/ranges/equity', { method: 'POST', body: payload });

    assert.equal(first.body.hero.equity, second.body.hero.equity);
  });

  it('does not add a history record', async () => {
    const before = await api('/api/history/stats');

    await api('/api/ranges/equity', {
      method: 'POST',
      body: JSON.stringify({ heroRange: ['AA'], villain: { cards: ['Kd', 'Kc'] }, iterations: 500 })
    });

    const after = await api('/api/history/stats');
    assert.equal(after.body.total, before.body.total);
  });

  it('rejects a missing hero range', async () => {
    const { status, body } = await api('/api/ranges/equity', {
      method: 'POST',
      body: JSON.stringify({ villain: { cards: ['Kd', 'Kc'] } })
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
    assert.ok(body.error.details.length > 0);
  });

  it('rejects an invalid hand code and says which one', async () => {
    const { status, body } = await api('/api/ranges/equity', {
      method: 'POST',
      body: JSON.stringify({ heroRange: ['AA', 'nope'], villain: { cards: ['Kd', 'Kc'] } })
    });

    assert.equal(status, 400);
    assert.ok(body.error.details.some(detail => detail.includes('nope')));
  });

  it('reports 422 when blocked cards eliminate every hero combo', async () => {
    const { status, body } = await api('/api/ranges/equity', {
      method: 'POST',
      body: JSON.stringify({
        heroRange: ['AA'],
        villain: { cards: ['Kd', 'Kc'] },
        dead: ['As', 'Ah', 'Ad', 'Ac']
      })
    });

    assert.equal(status, 422);
    assert.equal(body.error.code, 'UNPROCESSABLE');
  });
});

describe('/api/history', () => {
  it('returns the records created by earlier calculations', async () => {
    const { status, body } = await api('/api/history');

    assert.equal(status, 200);
    assert.ok(body.total >= 3);
    assert.ok(body.items[0].createdAt);
    assert.equal(body.items[0].type, 'equity');
  });

  it('caps the page size', async () => {
    const { body } = await api('/api/history?limit=1');
    assert.equal(body.items.length, 1);
    assert.equal(body.limit, 1);
  });

  it('reports stats', async () => {
    const { status, body } = await api('/api/history/stats');
    assert.equal(status, 200);
    assert.ok(body.total >= 3);
  });

  it('fetches a single record by id', async () => {
    const { body: page } = await api('/api/history?limit=1');
    const { status, body } = await api(`/api/history/${page.items[0].id}`);

    assert.equal(status, 200);
    assert.equal(body.id, page.items[0].id);
  });

  it('404s for an unknown id', async () => {
    const { status, body } = await api('/api/history/not-a-real-id');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('deletes a record', async () => {
    const { body: page } = await api('/api/history?limit=1');
    const { status } = await api(`/api/history/${page.items[0].id}`, { method: 'DELETE' });

    assert.equal(status, 204);
    assert.equal((await api(`/api/history/${page.items[0].id}`)).status, 404);
  });

  it('clears every record', async () => {
    const { status, body } = await api('/api/history', { method: 'DELETE' });
    assert.equal(status, 200);
    assert.ok(body.removed > 0);
    assert.equal((await api('/api/history')).body.total, 0);
  });
});

describe('/api/tournaments', () => {
  it('creates a tournament with defaulted settings', async () => {
    const { status, body } = await api('/api/tournaments', {
      method: 'POST',
      body: JSON.stringify({ name: 'Friday night' })
    });

    assert.equal(status, 201);
    assert.equal(body.name, 'Friday night');
    assert.equal(body.status, 'setup');
    assert.ok(body.structure.length > 0);
    assert.equal(body.derived.activePlayerCount, 0);
    assert.equal(body.derived.prizePool, 0);
  });

  it('rejects a tournament with no name', async () => {
    const { status, body } = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  it('lists tournaments newest first with summary fields', async () => {
    const { body } = await api('/api/tournaments');
    assert.ok(body.total >= 1);
    assert.ok('playerCount' in body.items[0]);
    assert.ok(!('players' in body.items[0]), 'the list view should be a lightweight summary');
  });

  it('summarises which level a tournament is on, not just that it is active', async () => {
    // A list row saying "active" answers nothing useful -- the question is
    // always what level and what blinds, so the summary carries the level.
    const { body } = await api('/api/tournaments');
    const summary = body.items[0];

    assert.ok(summary.currentLevel, 'the summary carries the current level');
    assert.equal(typeof summary.currentLevel.level, 'number');
    assert.equal(typeof summary.currentLevel.smallBlind, 'number');
    assert.equal(typeof summary.currentLevel.bigBlind, 'number');
    assert.ok(['running', 'paused'].includes(summary.clockStatus));
    assert.ok(!('structure' in summary), 'but not the whole blind structure');
  });

  it('runs a full lifecycle: register, buy in, start the clock, and eliminate down to a winner', async () => {
    const created = await api('/api/tournaments', {
      method: 'POST',
      body: JSON.stringify({ name: 'Lifecycle test', startingStack: 5000, buyIn: 10 })
    });
    const id = created.body.id;

    const p1 = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Alice' }) });
    const p2 = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Bob' }) });
    assert.equal(p1.status, 201);
    assert.equal(p2.body.players.length, 2);
    assert.equal(p2.body.derived.totalChipsInPlay, 10000);
    assert.equal(p2.body.derived.averageStack, 5000);

    const alicePlayerId = p2.body.players[0].id;
    const rebuy = await api(`/api/tournaments/${id}/players/${alicePlayerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'rebuy' })
    });
    assert.equal(rebuy.body.players[0].rebuys, 1);
    assert.equal(rebuy.body.derived.prizePool, 30); // 10 + 10 + 10 (rebuy)

    const started = await api(`/api/tournaments/${id}/clock`, { method: 'PATCH', body: JSON.stringify({ action: 'start' }) });
    assert.equal(started.status, 200);
    assert.equal(started.body.status, 'active');
    assert.equal(started.body.derived.clock.levelIndex, 0);

    const bobPlayerId = p2.body.players[1].id;
    const eliminated = await api(`/api/tournaments/${id}/players/${bobPlayerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'eliminate' })
    });
    assert.equal(eliminated.body.status, 'completed', 'one player remaining decides the tournament');
    assert.equal(eliminated.body.players.find(p => p.id === alicePlayerId).place, 1);
    assert.equal(eliminated.body.derived.payouts[0].amount, eliminated.body.derived.prizePool);
  });

  it('rejects an unknown player action', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Bad action test' }) });
    const registered = await api(`/api/tournaments/${created.body.id}/players`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Eve' })
    });
    const playerId = registered.body.players[0].id;

    const { status, body } = await api(`/api/tournaments/${created.body.id}/players/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'not-a-real-action' })
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  it('refuses to pause a clock that is not running', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Pause test' }) });
    const { status, body } = await api(`/api/tournaments/${created.body.id}/clock`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'pause' })
    });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'UNPROCESSABLE');
  });

  it('refuses to change settings once the tournament has started', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Settings test' }) });
    await api(`/api/tournaments/${created.body.id}/clock`, { method: 'PATCH', body: JSON.stringify({ action: 'start' }) });

    const { status, body } = await api(`/api/tournaments/${created.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' })
    });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'UNPROCESSABLE');
  });

  it('404s for an unknown tournament', async () => {
    const { status, body } = await api('/api/tournaments/not-a-real-id');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('deletes a tournament', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Deletable' }) });
    const { status } = await api(`/api/tournaments/${created.body.id}`, { method: 'DELETE' });
    assert.equal(status, 204);
    assert.equal((await api(`/api/tournaments/${created.body.id}`)).status, 404);
  });

  it('suggests a wider payout split than winner-take-all once the field grows', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Payout suggestion test' }) });
    assert.deepEqual(created.body.payoutSplit, [100], 'no players yet: nothing to suggest but first place');

    const id = created.body.id;
    let last;
    for (const name of ['A', 'B', 'C', 'D']) {
      last = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name }) });
    }
    assert.ok(last.body.payoutSplit.length > 1, 'a 4-player field should not default to winner-take-all');
    assert.equal(last.body.derived.payouts.length, last.body.payoutSplit.length);
  });

  it('keeps an organizer-chosen payout split fixed as players register', async () => {
    const created = await api('/api/tournaments', {
      method: 'POST',
      body: JSON.stringify({ name: 'Custom payout test', payoutSplit: [100] })
    });

    const id = created.body.id;
    let last;
    for (const name of ['A', 'B', 'C', 'D']) {
      last = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name }) });
    }
    assert.deepEqual(last.body.payoutSplit, [100], 'an explicit choice at creation must not be overridden later');
  });

  it('lets the organizer override the payout split via settings while still in setup', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Override test' }) });
    const updated = await api(`/api/tournaments/${created.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ payoutSplit: [70, 30] })
    });
    assert.deepEqual(updated.body.payoutSplit, [70, 30]);

    await api(`/api/tournaments/${created.body.id}/players`, { method: 'POST', body: JSON.stringify({ name: 'A' }) });
    const afterRegister = await api(`/api/tournaments/${created.body.id}`);
    assert.deepEqual(afterRegister.body.payoutSplit, [70, 30], 'the override must survive a later registration');
  });

  it('resets a tournament to setup, clearing progress but keeping the roster', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Reset test' }) });
    const id = created.body.id;

    const p1 = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Alice' }) });
    await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Bob' }) });
    const alicePlayerId = p1.body.players[0].id;

    await api(`/api/tournaments/${id}/players/${alicePlayerId}`, { method: 'PATCH', body: JSON.stringify({ action: 'rebuy' }) });
    await api(`/api/tournaments/${id}/clock`, { method: 'PATCH', body: JSON.stringify({ action: 'start' }) });
    await api(`/api/tournaments/${id}/players/${alicePlayerId}`, { method: 'PATCH', body: JSON.stringify({ action: 'eliminate' }) });

    const { status, body } = await api(`/api/tournaments/${id}/reset`, { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(body.status, 'setup');
    assert.equal(body.clock.currentLevelIndex, 0);
    assert.equal(body.clock.status, 'paused');
    assert.equal(body.players.length, 2, 'the roster is kept');
    assert.ok(body.players.every(p => !p.eliminated && p.rebuys === 0 && p.place === null));

    // A reset tournament is back in `setup`, so the clock can be started again.
    const restarted = await api(`/api/tournaments/${id}/clock`, { method: 'PATCH', body: JSON.stringify({ action: 'start' }) });
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.status, 'active');
  });

  it('404s resetting an unknown tournament', async () => {
    const { status } = await api('/api/tournaments/not-a-real-id/reset', { method: 'POST' });
    assert.equal(status, 404);
  });

  it('closes registration and refuses further player registrations', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Closes registration' }) });
    const id = created.body.id;
    assert.equal(created.body.registrationOpen, true);

    const closed = await api(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ action: 'close' }) });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.registrationOpen, false);

    const { status, body } = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Late Larry' }) });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'UNPROCESSABLE');

    const reopened = await api(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ action: 'reopen' }) });
    assert.equal(reopened.body.registrationOpen, true);
    const registered = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'On Time Otto' }) });
    assert.equal(registered.status, 201);
  });

  it('force-closes registration once the tournament is decided and refuses to reopen it', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Decided tournament' }) });
    const id = created.body.id;
    const p1 = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Alice' }) });
    await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Bob' }) });

    const eliminated = await api(`/api/tournaments/${id}/players/${p1.body.players[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'eliminate' })
    });
    assert.equal(eliminated.body.status, 'completed');
    assert.equal(eliminated.body.registrationOpen, false, 'a decided tournament auto-closes registration');

    const registerAttempt = await api(`/api/tournaments/${id}/players`, { method: 'POST', body: JSON.stringify({ name: 'Too Late' }) });
    assert.equal(registerAttempt.status, 422, 'nobody should be able to register into an already-paid-out tournament');

    const reopenAttempt = await api(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ action: 'reopen' }) });
    assert.equal(reopenAttempt.status, 422, 'a completed tournament cannot have registration reopened');
  });

  it('finalizes the payout split by paid-places once registration has closed, even after the clock has started', async () => {
    const created = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Late reg payout test' }) });
    const id = created.body.id;
    await api(`/api/tournaments/${id}/clock`, { method: 'PATCH', body: JSON.stringify({ action: 'start' }) });

    // Still open (late registration window): the payout split can't be finalized yet.
    const tooEarly = await api(`/api/tournaments/${id}`, { method: 'PATCH', body: JSON.stringify({ payoutSplit: [70, 30] }) });
    assert.equal(tooEarly.status, 422);

    await api(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ action: 'close' }) });
    const finalized = await api(`/api/tournaments/${id}`, { method: 'PATCH', body: JSON.stringify({ payoutSplit: [70, 30] }) });
    assert.equal(finalized.status, 200);
    assert.deepEqual(finalized.body.payoutSplit, [70, 30]);

    // A settings field other than payoutSplit is still off-limits post-start.
    const renameAttempt = await api(`/api/tournaments/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) });
    assert.equal(renameAttempt.status, 422);
  });
});

// The one block in this suite that writes to the real `users`/`sessions`/
// `hands` tables rather than a temp directory or a throwaway table: unlike
// `PostgresStore`, none of the three repositories it exercises take a table
// name, so there is nothing to point somewhere disposable. Isolation is by
// ownership instead -- every test signs up its own account with a random
// email and touches only its own rows -- and the `after` hook at the bottom
// is what keeps that claim honest rather than merely intended.
describe('/api/hands', { skip: dbSkip }, () => {
  before(async () => {
    handTablesBaseline = await tableCounts();
  });

  after(async () => {
    if (createdUserIds.length === 0) return;
    // Deleting the accounts takes their hands and sessions with them, by the
    // cascades `migrations/0002_users_and_ownership.sql` declares. The check
    // that this actually emptied the tables is the block below, not an
    // assertion here: node:test reports a failing `after` hook as `not ok`
    // but leaves the run's exit code at 0, so a hook is the one place an
    // assertion cannot fail the suite.
    await getPool().query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  });

  /** @param {object} [overrides] @returns {object} a saveable hand payload */
  function handPayload(overrides = {}) {
    return { ...createEmptyHand({ seatCount: 6 }), name: 'Three-bet pot', ...overrides };
  }

  /**
   * Sign up a fresh account and return a browser already holding its session.
   * A new email every time, so tests never collide over the unique index and
   * no test can see a hand another one saved.
   * @returns {Promise<{agent: (pathname: string, options?: RequestInit) => Promise<{status: number, body: any}>, user: object}>}
   */
  async function signUpAndLogIn() {
    const agent = browser();
    const { status, body } = await agent('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: `${randomUUID()}@example.test`,
        password: 'a-fine-password',
        displayName: 'Test Player'
      })
    });

    assert.equal(status, 201, `signup failed: ${JSON.stringify(body)}`);
    createdUserIds.push(body.user.id);
    return { agent, user: body.user };
  }

  it('saves a hand and returns it with derived pot maths', async () => {
    const { agent } = await signUpAndLogIn();

    const { status, body } = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({
        format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: null, straddleAmount: 0 },
        streets: {
          preflop: {
            board: [],
            actions: [{ seatNumber: 3, type: 'raise', amount: 6 }, { seatNumber: 2, type: 'call', amount: 6 }],
            notes: 'opened from UTG, I defended'
          },
          // The big blind folds the flop, which is what hands seat 3 the pot --
          // no winner is sent in the payload.
          flop: { board: ['As', 'Kd', '7h'], actions: [{ seatNumber: 2, type: 'fold' }], notes: 'top pair' },
          turn: { board: [], actions: [], notes: '' },
          river: { board: [], actions: [], notes: '' }
        },
        result: { notes: 'held up' }
      }))
    });

    assert.equal(status, 201);
    assert.ok(body.id);
    // SB 1 + BB called to 6 + raiser 6 = 13.
    assert.equal(body.derived.totalPot, 13);
    assert.equal(body.derived.potAfterStreet.preflop, 13);
    assert.equal(body.derived.positions[0], 'BTN');
    assert.deepEqual(body.derived.winningSeats, [3], 'the winner is derived, not supplied');
    assert.deepEqual(body.derived.payouts, [{ seatNumber: 3, amount: 13 }]);
    assert.equal(body.derived.furthestStreet, 'flop');
    assert.equal(body.streets.preflop.notes, 'opened from UTG, I defended');
  });

  it('rejects a hand with no name', async () => {
    const { agent } = await signUpAndLogIn();

    const { status, body } = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: '' }))
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
    assert.ok(body.error.details.some(detail => detail.includes('`name`')));
  });

  it('rejects a hand whose board reuses a hole card', async () => {
    const { agent } = await signUpAndLogIn();
    const seats = createEmptyHand({ seatCount: 6 }).seats.map((seat, index) =>
      index === 0 ? { ...seat, cards: ['As', 'Kd'] } : seat);

    const { status, body } = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({
        seats,
        streets: {
          preflop: { board: [], actions: [], notes: '' },
          flop: { board: ['As', '7c', '2h'], actions: [], notes: '' },
          turn: { board: [], actions: [], notes: '' },
          river: { board: [], actions: [], notes: '' }
        }
      }))
    });

    assert.equal(status, 400);
    assert.ok(body.error.details.some(detail => detail.includes('As')));
  });

  // Renamed from 'reads a saved hand back by id, which is what a shared link
  // does'. That is no longer what a shared link does: an id is reachable only
  // by the hand's owner now, and sharing goes through a separate token and a
  // separate route -- which the three tests after this one cover.
  it('reads a saved hand back by id, as its owner', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Shareable' }))
    });

    const { status, body } = await agent(`/api/hands/${created.body.id}`);
    assert.equal(status, 200);
    assert.equal(body.name, 'Shareable');
    assert.ok(body.derived, 'a cold-loaded hand still ships its derived maths');
  });

  it('requires a session to read a hand by id, even with the right id', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', { method: 'POST', body: JSON.stringify(handPayload()) });

    // A brand-new jar: the real id, and no cookie at all.
    const { status, body } = await browser()(`/api/hands/${created.body.id}`);
    assert.equal(status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('reports another account\'s hand as missing, not as forbidden', async () => {
    const owner = await signUpAndLogIn();
    const created = await owner.agent('/api/hands', { method: 'POST', body: JSON.stringify(handPayload()) });

    const stranger = await signUpAndLogIn();
    const { status, body } = await stranger.agent(`/api/hands/${created.body.id}`);

    // 404 rather than 403, deliberately: a 403 would confirm the hand exists,
    // which is the one thing a stranger holding an id should not learn.
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('serves a shared hand to a caller with no session at all', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Shared away' }))
    });

    const shared = await agent(`/api/hands/${created.body.id}/share`, { method: 'POST' });
    assert.equal(shared.status, 200);
    assert.ok(shared.body.shareToken, 'sharing hands back the token the owner needs to build a link');

    const { status, body } = await browser()(`/api/shared-hands/${shared.body.shareToken}`);
    assert.equal(status, 200);
    assert.equal(body.name, 'Shared away');
    assert.ok(body.derived, 'a shared hand is the whole hand, derived maths included');
    assert.equal(body.shareToken, undefined, 'a viewer has no reason to see the token that let them in');
  });

  it('stops serving a shared hand once the link is revoked', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', { method: 'POST', body: JSON.stringify(handPayload()) });
    const shared = await agent(`/api/hands/${created.body.id}/share`, { method: 'POST' });

    const revoked = await agent(`/api/hands/${created.body.id}/share`, { method: 'DELETE' });
    assert.equal(revoked.status, 204);

    assert.equal((await browser()(`/api/shared-hands/${shared.body.shareToken}`)).status, 404);
    assert.equal(
      (await agent(`/api/hands/${created.body.id}`)).status,
      200,
      'revoking the link leaves the hand itself alone'
    );
  });

  it('edits a saved hand in place, keeping its id so the link still resolves', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Original' }))
    });

    const { status, body } = await agent(`/api/hands/${created.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed after the fact' })
    });

    assert.equal(status, 200);
    assert.equal(body.id, created.body.id);
    assert.equal(body.name, 'Renamed after the fact');
    assert.equal(body.seats.length, 6, 'a partial edit must not drop the rest of the hand');
  });

  it('rejects an edit that would make the hand invalid', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', { method: 'POST', body: JSON.stringify(handPayload()) });

    const { status } = await agent(`/api/hands/${created.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ buttonSeat: 99 })
    });
    assert.equal(status, 400);
  });

  // The old version of this test asserted only that *some* hand came back,
  // which held because every test before it had written into one shared
  // collection. There is no "every hand in the system" any more, and no
  // endpoint that would answer for one, so what it asserts now is the claim
  // that survived the change: this account's hands, and nobody else's.
  it('lists only this account\'s hands, as lightweight summaries, newest first', async () => {
    const { agent } = await signUpAndLogIn();
    const first = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Older' }))
    });
    const second = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Newer' }))
    });

    const stranger = await signUpAndLogIn();
    await stranger.agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Someone else\'s' }))
    });

    const { status, body } = await agent('/api/hands?limit=50');

    assert.equal(status, 200);
    assert.equal(body.total, 2, 'the total is scoped to the owner too, not just the page');
    assert.deepEqual(body.items.map(item => item.id), [second.body.id, first.body.id]);

    const summary = body.items[0];
    assert.equal(summary.name, 'Newer');
    assert.equal(summary.seatCount, 6);
    assert.ok('totalPot' in summary);
    assert.ok('heroCards' in summary);
    assert.equal(summary.seats, undefined, 'the full roster is not shipped to a list view');
  });

  it('requires a session to list hands', async () => {
    const { status, body } = await browser()('/api/hands');
    assert.equal(status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('deletes a hand', async () => {
    const { agent } = await signUpAndLogIn();
    const created = await agent('/api/hands', {
      method: 'POST',
      body: JSON.stringify(handPayload({ name: 'Deletable' }))
    });

    const { status } = await agent(`/api/hands/${created.body.id}`, { method: 'DELETE' });
    assert.equal(status, 204);
    assert.equal((await agent(`/api/hands/${created.body.id}`)).status, 404);
  });

  it('refuses to delete another account\'s hand, and leaves it standing', async () => {
    const owner = await signUpAndLogIn();
    const created = await owner.agent('/api/hands', { method: 'POST', body: JSON.stringify(handPayload()) });

    const stranger = await signUpAndLogIn();
    assert.equal((await stranger.agent(`/api/hands/${created.body.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await owner.agent(`/api/hands/${created.body.id}`)).status, 200, 'still there for its owner');
  });

  // A well-formed id that was simply never issued. It has to be a real UUID:
  // `id` is a uuid column now, so a string that isn't one fails to parse in
  // Postgres rather than matching nothing -- a different failure than the one
  // this test is about.
  it('404s for an unknown hand', async () => {
    const { agent } = await signUpAndLogIn();

    const { status, body } = await agent(`/api/hands/${randomUUID()}`);
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  // `not-a-real-id` is kept as a literal on purpose: it is the exact string
  // that surfaced this, and it fails differently from the well-formed id in
  // the test above. `id` is a uuid column, so Postgres cannot parse this one
  // at all (22P02) rather than parsing it and matching nothing. Both are "no
  // such hand" to a caller. One test per verb, because each runs its own
  // query and so could regress on its own.
  it('404s for a malformed hand id on GET', async () => {
    const { agent } = await signUpAndLogIn();

    const { status, body } = await agent('/api/hands/not-a-real-id');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('404s for a malformed hand id on PATCH', async () => {
    const { agent } = await signUpAndLogIn();

    const { status, body } = await agent('/api/hands/not-a-real-id', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' })
    });
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('404s for a malformed hand id on DELETE', async () => {
    const { agent } = await signUpAndLogIn();

    const { status, body } = await agent('/api/hands/not-a-real-id', { method: 'DELETE' });
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('404s for a share token that was never issued', async () => {
    const { status, body } = await browser()('/api/shared-hands/not-a-real-token');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});

// Deliberately a separate block rather than an assertion in the hook above:
// a following top-level suite runs after the previous one's `after` has
// completed, so the deletes have happened by the time this reads the counts,
// and a failure here is a failed *test* -- which is what actually fails the
// run. It is the evidence for the isolation claim above `/api/hands`: if a
// future test signs up an account it never registers for teardown, or a
// cascade stops cascading, this goes red instead of quietly leaving rows in
// whichever database the suite was pointed at.
describe('/api/hands cleanup', { skip: dbSkip }, () => {
  it('leaves no rows behind in the real tables', async () => {
    assert.deepEqual(await tableCounts(), handTablesBaseline);
  });
});

describe('routing', () => {
  it('404s an unknown API path as JSON', async () => {
    const { status, body } = await api('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('serves the single-page app for unknown non-API paths', async () => {
    const response = await fetch(`${baseUrl}/some/client/route`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root">/);
  });

  it('serves the shared domain modules to the browser', async () => {
    const response = await fetch(`${baseUrl}/shared/poker/cards.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /export function createDeck/);
  });
});
