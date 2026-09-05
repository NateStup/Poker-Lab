/**
 * Application service for accounts.
 *
 * Same shape as `HandLogService`: validation and rules live here, routes
 * stay thin. Deliberately does not touch `req`/`res` or cookies at all --
 * those are HTTP concerns that belong in `authRoutes.js`, the same split
 * every other service in this app already keeps.
 */

import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { ApiError } from '../errors/ApiError.js';
import { EmailAlreadyRegisteredError } from '../store/UsersRepository.js';

const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 60;

export class AuthService {
  /**
   * @param {{
   *   usersRepository: import('../store/UsersRepository.js').UsersRepository,
   *   sessionsRepository: import('../store/SessionsRepository.js').SessionsRepository
   * }} deps
   */
  constructor({ usersRepository, sessionsRepository }) {
    this.users = usersRepository;
    this.sessions = sessionsRepository;
  }

  /**
   * @param {{email?: unknown, password?: unknown, displayName?: unknown}} payload
   * @returns {Promise<{user: object, sessionId: string}>}
   */
  async signup({ email, password, displayName }) {
    const errors = validateSignup({ email, password, displayName });
    if (errors.length > 0) throw ApiError.badRequest('Could not create an account.', errors);

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await this.users.create({ email, passwordHash, displayName: displayName.trim() });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        throw ApiError.unprocessable(error.message);
      }
      throw error;
    }

    const session = await this.sessions.create(user.id);
    return { user, sessionId: session.id };
  }

  /**
   * @param {{email?: unknown, password?: unknown}} payload
   * @returns {Promise<{user: object, sessionId: string}>}
   */
  async login({ email, password }) {
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw ApiError.badRequest('Email and password are both required.');
    }

    // The same error, whichever step fails: telling a caller "no account
    // with that email" versus "wrong password" is exactly enough for them to
    // discover which emails have accounts on this app, one guess at a time.
    const invalidCredentials = () => ApiError.unauthorized('Invalid email or password.');

    const user = await this.users.findByEmailWithPasswordHash(email);
    if (!user) throw invalidCredentials();

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw invalidCredentials();

    const session = await this.sessions.create(user.id);
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return { user: publicUser, sessionId: session.id };
  }

  /** @param {string|undefined} sessionId */
  async logout(sessionId) {
    // Idempotent on purpose: logging out with an already-expired or
    // already-cleared session isn't an error, it's just already done.
    if (sessionId) await this.sessions.destroy(sessionId);
  }

  /**
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async currentUser(userId) {
    const user = await this.users.findById(userId);
    // The session was valid (requireAuth already checked), but the account
    // behind it is gone -- there's no user-deletion feature yet, so this is
    // unreachable today, but a session outliving its account is a real
    // possibility the moment one exists, and this is what should happen when
    // it does: the session stops being usable, cleanly, rather than serving
    // a user object that's a lie.
    if (!user) throw ApiError.unauthorized('Session no longer valid.');
    return user;
  }
}

/**
 * @param {{email?: unknown, password?: unknown, displayName?: unknown}} payload
 * @returns {string[]} validation problems, empty when the payload is usable
 */
function validateSignup({ email, password, displayName }) {
  const errors = [];

  // Not full RFC 5322 validation -- that's a well-known rabbit hole with
  // little real payoff, and this app sends no confirmation email, so the
  // only thing worth checking here is "does this look like an email at all."
  if (typeof email !== 'string' || !email.includes('@') || email.trim().length === 0) {
    errors.push('A valid email is required.');
  }

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    errors.push('A display name is required.');
  } else if (displayName.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push(`Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`);
  }

  return errors;
}
