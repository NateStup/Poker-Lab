/**
 * End-to-end API tests.
 *
 * The app is booted on an ephemeral port with a repository backed by a temp
 * directory, then driven with the global `fetch`. That exercises the real
 * middleware stack -- body parsing, routing, error handling -- without pulling
 * in a test-only HTTP client dependency.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../../src/server/app.js';
import { HistoryRepository } from '../../src/server/store/HistoryRepository.js';
import { JsonFileStore } from '../../src/server/store/JsonFileStore.js';
import { TournamentRepository } from '../../src/server/store/TournamentRepository.js';

let server;
let baseUrl;
let tempDir;

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

  const app = await createApp({ historyRepository, tournamentRepository });
  server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
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
