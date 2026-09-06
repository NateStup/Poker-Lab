/**
 * HandLogService tests.
 *
 * The service takes its repository by constructor injection, so these run
 * against a fake one and need no database at all -- which is the point. The
 * behaviour under test is what happens when an owner-scoped write matches no
 * row, and that is not reachable through the real repository without genuine
 * concurrency: the row would have to disappear between two statements of the
 * same request. A fake that reports the miss on demand tests the service's
 * response to it directly, rather than trying to provoke a race.
 *
 * Before the write results were checked, a miss here did not surface as a
 * 404. It sailed past into `#decorate`, which called `computeHandDerived` on
 * `null` and threw -- a raw 500 for what is simply a hand that is no longer
 * there.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HandLogService } from '../../src/server/services/HandLogService.js';
import { createEmptyHand, validateHandLogRequest } from '../../src/shared/handLog/index.js';

/**
 * A stored hand, shaped the way `HandLogRepository` hands one back.
 * @returns {object}
 */
function storedHand() {
  const { valid, errors, value } = validateHandLogRequest({
    ...createEmptyHand({ seatCount: 6 }),
    name: 'Aces cracked'
  });
  assert.ok(valid, `test fixture must be valid: ${errors.join(' ')}`);
  return { id: 'hand-1', createdAt: new Date().toISOString(), shareToken: null, ...value };
}

/**
 * A repository that records what it was asked and answers however the test
 * says. Every method defaults to "found", so a test only states the miss it
 * cares about.
 * @param {object} [answers] per-method overrides
 * @returns {object}
 */
function fakeRepository(answers = {}) {
  const calls = [];
  const record = name => (...args) => {
    calls.push(name);
    const answer = answers[name];
    return Promise.resolve(typeof answer === 'function' ? answer(...args) : answer);
  };

  return {
    calls,
    findOwned: record('findOwned'),
    update: record('update'),
    remove: record('remove'),
    setShareToken: record('setShareToken'),
    create: record('create'),
    listForOwner: record('listForOwner'),
    findByShareToken: record('findByShareToken')
  };
}

/**
 * @param {Promise<unknown>} promise
 * @param {number} status
 * @param {string} message
 */
async function assertApiError(promise, status, message) {
  await assert.rejects(promise, error => {
    assert.equal(error.status, status, `expected HTTP ${status}, got ${error.status}`);
    assert.equal(error.message, message);
    return true;
  });
}

describe('HandLogService write paths', () => {
  // Each of these answers `findOwned` with a real hand *and* the write with a
  // miss. That combination is the race itself: the row was there when a read
  // would have looked, and gone by the time the write ran. It also means these
  // cannot pass merely because a pre-read happened to fail -- the pre-read, if
  // one were still there, would succeed and prove nothing.
  it('reports 404 rather than crashing when share\'s write finds no row', async () => {
    const repository = fakeRepository({ findOwned: storedHand(), setShareToken: null });
    const service = new HandLogService({ handLogRepository: repository });

    await assertApiError(service.share('hand-1', 'user-1'), 404, 'Hand not found');
  });

  it('reports 404 rather than crashing when unshare\'s write finds no row', async () => {
    const repository = fakeRepository({ findOwned: storedHand(), setShareToken: null });
    const service = new HandLogService({ handLogRepository: repository });

    await assertApiError(service.unshare('hand-1', 'user-1'), 404, 'Hand not found');
  });

  it('reports 404 when remove matches no row', async () => {
    const repository = fakeRepository({ findOwned: storedHand(), remove: false });
    const service = new HandLogService({ handLogRepository: repository });

    await assertApiError(service.remove('hand-1', 'user-1'), 404, 'Hand not found');
  });

  // The one place a read before the write is legitimate -- `update` needs the
  // stored record to merge the patch over -- and so the one place the row can
  // still vanish in between. The write's own result has to be checked too.
  it('reports 404 when the row disappears between update\'s read and its write', async () => {
    const repository = fakeRepository({ findOwned: storedHand(), update: null });
    const service = new HandLogService({ handLogRepository: repository });

    await assertApiError(service.update('hand-1', 'user-1', { name: 'Renamed' }), 404, 'Hand not found');
    assert.deepEqual(repository.calls, ['findOwned', 'update'], 'read once, then wrote once');
  });

  it('does not re-read a hand it is about to write over', async () => {
    // The repository folds the owner into every statement, so a SELECT to
    // confirm what the UPDATE is about to confirm again buys nothing but a
    // window for the row to change in. These three writes should each be a
    // single statement.
    const hand = storedHand();

    const shared = fakeRepository({ setShareToken: { ...hand, shareToken: 'tok' } });
    await new HandLogService({ handLogRepository: shared }).share('hand-1', 'user-1');
    assert.deepEqual(shared.calls, ['setShareToken'], 'share writes once, with no read first');

    const revoked = fakeRepository({ setShareToken: hand });
    await new HandLogService({ handLogRepository: revoked }).unshare('hand-1', 'user-1');
    assert.deepEqual(revoked.calls, ['setShareToken'], 'unshare writes once, with no read first');

    const removed = fakeRepository({ remove: true });
    await new HandLogService({ handLogRepository: removed }).remove('hand-1', 'user-1');
    assert.deepEqual(removed.calls, ['remove'], 'remove writes once, with no read first');
  });

  it('still succeeds on the happy paths', async () => {
    const hand = storedHand();

    const shared = fakeRepository({ setShareToken: { ...hand, shareToken: 'tok' } });
    const result = await new HandLogService({ handLogRepository: shared }).share('hand-1', 'user-1');
    assert.equal(result.shareToken, 'tok');
    assert.ok(result.derived, 'a shared hand still comes back decorated');

    const removed = fakeRepository({ remove: true });
    assert.equal(await new HandLogService({ handLogRepository: removed }).remove('hand-1', 'user-1'), true);
  });
});
