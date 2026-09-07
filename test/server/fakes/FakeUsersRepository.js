/**
 * An in-memory stand-in for UsersRepository, for testing AuthService without
 * a database. Same interface, same failure modes (including throwing the
 * real EmailAlreadyRegisteredError, not a look-alike) -- the point is that
 * AuthService can't tell the difference, so its own policy is what's under
 * test, not Postgres.
 */

import { randomUUID } from 'node:crypto';

import { EmailAlreadyRegisteredError } from '../../../src/server/store/UsersRepository.js';

export class FakeUsersRepository {
  constructor() {
    /** @type {Map<string, object>} keyed by normalised email */
    this.byEmail = new Map();
  }

  /**
   * @param {{email: string, passwordHash: string, displayName: string}} account
   * @returns {Promise<object>}
   */
  async create({ email, passwordHash, displayName }) {
    const normalizedEmail = email.trim().toLowerCase();
    if (this.byEmail.has(normalizedEmail)) throw new EmailAlreadyRegisteredError();

    const user = {
      id: randomUUID(),
      email: normalizedEmail,
      displayName,
      createdAt: new Date().toISOString(),
      passwordHash
    };
    this.byEmail.set(normalizedEmail, user);
    return withoutHash(user);
  }

  /** @param {string} email @returns {Promise<object|null>} */
  async findByEmailWithPasswordHash(email) {
    const user = this.byEmail.get(email.trim().toLowerCase());
    return user ? { ...user } : null;
  }

  /** @param {string} id @returns {Promise<object|null>} */
  async findById(id) {
    for (const user of this.byEmail.values()) {
      if (user.id === id) return withoutHash(user);
    }
    return null;
  }
}

/** @param {object} user @returns {object} */
function withoutHash(user) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
