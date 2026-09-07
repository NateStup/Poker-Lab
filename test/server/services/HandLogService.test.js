/**
 * HandLogService tests.
 *
 * The service takes its repository by constructor injection, so all of this
 * runs against a fake and needs no database at all -- which is the point. It
 * covers two different things, both previously reachable only through
 * api.test.js's /api/hands block, which skips outright when no database is
 * reachable:
 *
 * - Ownership and sharing policy ("HandLogService" describe block): that a
 *   hand belonging to someone else is indistinguishable from a hand that
 *   doesn't exist, on every verb, and that sharing/revoking behave as
 *   documented.
 * - Write races ("write races" describe block): what happens when an
 *   owner-scoped write matches no row. That is not reachable through the
 *   real repository without genuine concurrency -- the row would have to
 *   disappear between two statements of the same request -- so
 *   `FakeHandLogRepository.runBeforeNext` exists specifically to recreate
 *   that window. Before the write results were checked, a miss here did not
 *   surface as a 404: it sailed past into `#decorate`, which called
 *   `computeHandDerived` on `null` and threw -- a raw 500 for what is simply
 *   a hand that is no longer there.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HandLogService } from '../../../src/server/services/HandLogService.js';
import { FakeHandLogRepository } from '../fakes/FakeHandLogRepository.js';

const OWNER = 'owner-user-id';
const STRANGER = 'stranger-user-id';

/**
 * A minimal hand payload that `validateHandLogRequest` accepts. Adjust the
 * shape here, in one place, if the validator's requirements change.
 * @param {object} [overrides]
 * @returns {object}
 */
function validHandPayload(overrides = {}) {
  return {
    name: 'Test hand',
    format: { gameType: 'cash', smallBlind: 1, bigBlind: 2 },
    seats: [
      { isHero: true, stack: 100, cards: ['As', 'Kd'] },
      { isHero: false, stack: 100, cards: [null, null] }
    ],
    buttonSeat: 1,
    streets: {
      preflop: { board: [], actions: [] },
      flop: { board: [], actions: [] },
      turn: { board: [], actions: [] },
      river: { board: [], actions: [] }
    },
    result: { notes: '' },
    ...overrides
  };
}

/** @returns {HandLogService} */
function makeService() {
  return new HandLogService({ handLogRepository: new FakeHandLogRepository() });
}

describe('HandLogService', () => {
  it('creates and reads back a hand for its owner', async () => {
    const service = makeService();
    const created = await service.create(validHandPayload(), OWNER);
    const fetched = await service.get(created.id, OWNER);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.shareToken, null);
  });

  it('rejects an invalid payload as 400', async () => {
    const service = makeService();
    await assert.rejects(
      service.create({ name: '' }, OWNER),
      error => error.status === 400
    );
  });

  describe("a hand that is not the caller's", () => {
    // Every one of these proves the same rule: get/update/remove/share/unshare
    // on a hand owned by someone else reports 404, on every verb, identically
    // to a hand that was never created at all. That indistinguishability is
    // the whole point of the ownership redesign -- these are the tests that
    // previously existed only behind a database connection.

    it("get reports 404, not the stranger's hand", async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);
      await assert.rejects(service.get(created.id, STRANGER), error => error.status === 404);
    });

    it('update reports 404 and leaves the hand unchanged', async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);

      await assert.rejects(
        service.update(created.id, STRANGER, validHandPayload({ name: 'Hijacked' })),
        error => error.status === 404
      );

      const stillOwned = await service.get(created.id, OWNER);
      assert.equal(stillOwned.name, 'Test hand');
    });

    it('remove reports 404 and leaves the hand in place', async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);

      await assert.rejects(service.remove(created.id, STRANGER), error => error.status === 404);
      await assert.doesNotReject(service.get(created.id, OWNER));
    });

    it('share reports 404 and does not create a token', async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);

      await assert.rejects(service.share(created.id, STRANGER), error => error.status === 404);

      const stillOwned = await service.get(created.id, OWNER);
      assert.equal(stillOwned.shareToken, null);
    });

    it('unshare reports 404', async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);
      await service.share(created.id, OWNER);

      await assert.rejects(service.unshare(created.id, STRANGER), error => error.status === 404);
    });

    it('a nonexistent id behaves identically to a real id owned by someone else', async () => {
      const service = makeService();

      let neverExisted;
      try {
        await service.get('does-not-exist', OWNER);
      } catch (error) {
        neverExisted = error;
      }

      const created = await service.create(validHandPayload(), OWNER);
      let stranger;
      try {
        await service.get(created.id, STRANGER);
      } catch (error) {
        stranger = error;
      }

      assert.equal(neverExisted.status, stranger.status);
      assert.equal(neverExisted.message, stranger.message);
    });
  });

  describe('sharing', () => {
    it('a shared hand is readable by token with no shareToken field in the response', async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);
      const shared = await service.share(created.id, OWNER);

      const viewed = await service.getShared(shared.shareToken);
      assert.equal(viewed.id, created.id);
      assert.equal('shareToken' in viewed, false);
    });

    it('revoking clears the token and the old link 404s', async () => {
      const service = makeService();
      const created = await service.create(validHandPayload(), OWNER);
      const shared = await service.share(created.id, OWNER);

      await service.unshare(created.id, OWNER);

      await assert.rejects(service.getShared(shared.shareToken), error => error.status === 404);
      const stillOwned = await service.get(created.id, OWNER);
      assert.equal(stillOwned.shareToken, null, 'revoking clears the token without touching the hand itself');
    });

    it('an unknown token 404s the same way a revoked one does', async () => {
      const service = makeService();
      await assert.rejects(service.getShared('never-issued'), error => error.status === 404);
    });
  });

  describe('write races', () => {
    // Each miss test below targets an id that was never created, so the
    // repository's single write statement is the only thing that can report
    // it -- there is no row for a pre-read to have found in the first place.
    // `repository.calls` proves that: exactly one call, the write itself.

    it("reports 404 rather than crashing when share's write finds no row", async () => {
      const repository = new FakeHandLogRepository();
      const service = new HandLogService({ handLogRepository: repository });

      await assert.rejects(service.share('does-not-exist', OWNER), error => error.status === 404);
      assert.deepEqual(repository.calls, ['setShareToken'], 'the miss is reported by the write, not a pre-read');
    });

    it("reports 404 rather than crashing when unshare's write finds no row", async () => {
      const repository = new FakeHandLogRepository();
      const service = new HandLogService({ handLogRepository: repository });

      await assert.rejects(service.unshare('does-not-exist', OWNER), error => error.status === 404);
      assert.deepEqual(repository.calls, ['setShareToken'], 'the miss is reported by the write, not a pre-read');
    });

    it('reports 404 when remove matches no row', async () => {
      const repository = new FakeHandLogRepository();
      const service = new HandLogService({ handLogRepository: repository });

      await assert.rejects(service.remove('does-not-exist', OWNER), error => error.status === 404);
      assert.deepEqual(repository.calls, ['remove'], 'the miss is reported by the write, not a pre-read');
    });

    // The one place a read before the write is legitimate -- `update` needs the
    // stored record to merge the patch over -- and so the one place the row can
    // still vanish in between. `runBeforeNext` recreates exactly that window:
    // the row is there when `findOwned` looks, and gone by the time `update`
    // runs. The write's own result has to be checked too, which is what turns
    // that into a 404 instead of a crash.
    it("reports 404 when the row disappears between update's read and its write", async () => {
      const repository = new FakeHandLogRepository();
      const service = new HandLogService({ handLogRepository: repository });
      const created = await repository.create(validHandPayload(), OWNER);

      repository.calls.length = 0;
      repository.runBeforeNext('update', () => repository.byId.delete(created.id));

      await assert.rejects(
        service.update(created.id, OWNER, validHandPayload({ name: 'Renamed' })),
        error => error.status === 404
      );
      assert.deepEqual(repository.calls, ['findOwned', 'update'], 'read once, then wrote once');
    });

    it('does not re-read a hand it is about to write over', async () => {
      // The repository folds the owner into every statement, so a SELECT to
      // confirm what the UPDATE is about to confirm again buys nothing but a
      // window for the row to change in. These three writes should each be a
      // single statement.
      const repository = new FakeHandLogRepository();
      const service = new HandLogService({ handLogRepository: repository });
      const created = await repository.create(validHandPayload(), OWNER);

      repository.calls.length = 0;
      await service.share(created.id, OWNER);
      assert.deepEqual(repository.calls, ['setShareToken'], 'share writes once, with no read first');

      repository.calls.length = 0;
      await service.unshare(created.id, OWNER);
      assert.deepEqual(repository.calls, ['setShareToken'], 'unshare writes once, with no read first');

      repository.calls.length = 0;
      await service.remove(created.id, OWNER);
      assert.deepEqual(repository.calls, ['remove'], 'remove writes once, with no read first');
    });

    it('still succeeds on the happy paths', async () => {
      const repository = new FakeHandLogRepository();
      const service = new HandLogService({ handLogRepository: repository });
      const created = await repository.create(validHandPayload(), OWNER);

      const shared = await service.share(created.id, OWNER);
      assert.equal(typeof shared.shareToken, 'string');
      assert.ok(shared.derived, 'a shared hand still comes back decorated');

      assert.equal(await service.remove(created.id, OWNER), true);
    });
  });
});
