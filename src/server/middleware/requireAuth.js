/**
 * Requires a valid session, and attaches `req.userId` for the route to use.
 *
 * Reads the signed session cookie rather than a bearer header, since this is
 * a same-origin app serving its own client -- nothing here benefits from a
 * token a browser is expected to attach manually, and a signed `httpOnly`
 * cookie is both simpler for the client and unreadable to any script running
 * on the page, which a token sitting in `localStorage` never is.
 */

import { ApiError } from '../errors/ApiError.js';

/** Shared with `authRoutes.js`, which sets and clears the same cookie. */
export const SESSION_COOKIE_NAME = 'pokerlab_session';

/**
 * @param {{sessionsRepository: import('../store/SessionsRepository.js').SessionsRepository}} deps
 * @returns {import('express').RequestHandler}
 */
export function createRequireAuth({ sessionsRepository }) {
  return async function requireAuth(req, res, next) {
    try {
      const sessionId = req.signedCookies[SESSION_COOKIE_NAME];
      if (!sessionId) throw ApiError.unauthorized('Log in to do that.');

      const session = await sessionsRepository.findValid(sessionId);
      if (!session) throw ApiError.unauthorized('Your session has expired -- log in again.');

      req.userId = session.userId;
      next();
    } catch (error) {
      next(error);
    }
  };
}
