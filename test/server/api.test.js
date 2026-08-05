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

  const app = await createApp({ historyRepository });
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
