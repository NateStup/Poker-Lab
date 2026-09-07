/**
 * Direct tests of AuthService's own policy, against fakes -- no HTTP layer,
 * no Postgres. This is the coverage that previously existed only through
 * api.test.js's /api/auth block, which skips outright when no database is
 * reachable. These run every time, regardless of Docker.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthService } from '../../../src/server/services/AuthService.js';
import { FakeSessionsRepository } from '../fakes/FakeSessionsRepository.js';
import { FakeUsersRepository } from '../fakes/FakeUsersRepository.js';

/**
 * @returns {{service: AuthService, usersRepository: FakeUsersRepository, sessionsRepository: FakeSessionsRepository}}
 */
function makeService() {
  const usersRepository = new FakeUsersRepository();
  const sessionsRepository = new FakeSessionsRepository();
  return { service: new AuthService({ usersRepository, sessionsRepository }), usersRepository, sessionsRepository };
}

describe('AuthService', () => {
  describe('signup', () => {
    it('creates an account and a session', async () => {
      const { service } = makeService();
      const { user, sessionId } = await service.signup({
        email: 'a@example.test',
        password: 'a-fine-password',
        displayName: 'Ada'
      });

      assert.equal(user.email, 'a@example.test');
      assert.equal(user.displayName, 'Ada');
      assert.equal(typeof sessionId, 'string');
      assert.equal('passwordHash' in user, false, 'the hash never leaves the service');
    });

    it('rejects a password below the minimum length', async () => {
      const { service } = makeService();
      await assert.rejects(
        service.signup({ email: 'a@example.test', password: 'short', displayName: 'Ada' }),
        error => error.status === 400
      );
    });

    it('rejects an email with no @', async () => {
      const { service } = makeService();
      await assert.rejects(
        service.signup({ email: 'not-an-email', password: 'a-fine-password', displayName: 'Ada' }),
        error => error.status === 400
      );
    });

    it('rejects a missing display name', async () => {
      const { service } = makeService();
      await assert.rejects(
        service.signup({ email: 'a@example.test', password: 'a-fine-password', displayName: '' }),
        error => error.status === 400
      );
    });

    it('rejects a second signup with the same email as 422, not a raw duplicate error', async () => {
      const { service } = makeService();
      await service.signup({ email: 'a@example.test', password: 'a-fine-password', displayName: 'Ada' });

      await assert.rejects(
        service.signup({ email: 'a@example.test', password: 'another-password', displayName: 'Someone else' }),
        error => error.status === 422
      );
    });
  });

  describe('login', () => {
    it('logs in with the right password', async () => {
      const { service } = makeService();
      await service.signup({ email: 'a@example.test', password: 'a-fine-password', displayName: 'Ada' });

      const { user, sessionId } = await service.login({ email: 'a@example.test', password: 'a-fine-password' });
      assert.equal(user.email, 'a@example.test');
      assert.equal(typeof sessionId, 'string');
    });

    it('reports the identical error for a wrong password and a nonexistent email', async () => {
      const { service } = makeService();
      await service.signup({ email: 'a@example.test', password: 'a-fine-password', displayName: 'Ada' });

      let wrongPasswordError;
      let noSuchEmailError;

      try {
        await service.login({ email: 'a@example.test', password: 'the-wrong-password' });
      } catch (error) {
        wrongPasswordError = error;
      }

      try {
        await service.login({ email: 'nobody@example.test', password: 'anything-at-all' });
      } catch (error) {
        noSuchEmailError = error;
      }

      assert.ok(wrongPasswordError, 'a wrong password must throw');
      assert.ok(noSuchEmailError, 'a nonexistent email must throw');
      assert.equal(wrongPasswordError.status, 401);
      assert.equal(noSuchEmailError.status, 401);
      assert.equal(
        wrongPasswordError.message,
        noSuchEmailError.message,
        'the two failure modes must be indistinguishable to the caller -- this is what stops a login attempt from being used to discover which emails have accounts'
      );
    });

    it('rejects a malformed payload as 400, not 401', async () => {
      const { service } = makeService();
      await assert.rejects(
        service.login({ email: 123, password: undefined }),
        error => error.status === 400
      );
    });
  });

  describe('logout', () => {
    it('is idempotent with no session id', async () => {
      const { service } = makeService();
      await assert.doesNotReject(service.logout(undefined));
    });

    it('destroys a real session so it can no longer be used', async () => {
      // Checked against the *same* sessionsRepository the service was built
      // with, not a fresh one -- a fresh fake would report every session
      // invalid regardless of whether logout actually did anything, which
      // would make this pass for the wrong reason.
      const { service, sessionsRepository } = makeService();
      const { sessionId } = await service.signup({
        email: 'a@example.test',
        password: 'a-fine-password',
        displayName: 'Ada'
      });

      assert.ok(await sessionsRepository.findValid(sessionId), 'sanity check: the session exists before logout');

      await service.logout(sessionId);

      assert.equal(await sessionsRepository.findValid(sessionId), null);
    });
  });

  describe('currentUser', () => {
    it('reports unauthorized if the account behind a valid session is gone', async () => {
      const { service, usersRepository } = makeService();

      const { user } = await service.signup({
        email: 'a@example.test',
        password: 'a-fine-password',
        displayName: 'Ada'
      });

      // Simulate the account disappearing without the session going with it --
      // there's no user-deletion feature yet, so this is the one way to reach
      // the defensive check in AuthService.currentUser at all.
      usersRepository.byEmail.delete('a@example.test');

      await assert.rejects(service.currentUser(user.id), error => error.status === 401);
    });
  });
});
