/**
 * An in-memory stand-in for SessionsRepository. No cryptographic randomness
 * needed for the id here -- nothing in a test is trying to guess it, so a
 * counter is honest rather than pretending to security properties this fake
 * doesn't need.
 */

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class FakeSessionsRepository {
  /** @param {{ttlMs?: number}} [options] */
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    /** @type {Map<string, {id: string, userId: string, expiresAt: number}>} */
    this.byId = new Map();
    this.nextId = 1;
  }

  /** @param {string} userId @returns {Promise<{id: string, userId: string, expiresAt: Date}>} */
  async create(userId) {
    const id = `fake-session-${this.nextId++}`;
    const expiresAt = Date.now() + this.ttlMs;
    this.byId.set(id, { id, userId, expiresAt });
    return { id, userId, expiresAt: new Date(expiresAt) };
  }

  /** @param {string} id @returns {Promise<{id: string, userId: string}|null>} */
  async findValid(id) {
    const session = this.byId.get(id);
    if (!session || session.expiresAt <= Date.now()) return null;
    return { id: session.id, userId: session.userId };
  }

  /** @param {string} id @returns {Promise<void>} */
  async destroy(id) {
    this.byId.delete(id);
  }
}
