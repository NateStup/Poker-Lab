/**
 * Attaches `req.userId` if a valid session exists, but never rejects a
 * request for lacking one -- the sibling to `requireAuth`, for routes that
 * behave differently for a logged-in caller without requiring one.
 *
 * Shares `SESSION_COOKIE_NAME` with `requireAuth.js` rather than defining
 * its own copy, so there's exactly one name for the cookie both middlewares
 * read.
 */

import { SESSION_COOKIE_NAME } from './requireAuth.js';

/**
 * @param {{sessionsRepository: import('../store/SessionsRepository.js').SessionsRepository}} deps
 * @returns {import('express').RequestHandler}
 */
export function createOptionalAuth({ sessionsRepository }) {
  return async function optionalAuth(req, res, next) {
    try {
      const sessionId = req.signedCookies[SESSION_COOKIE_NAME];
      if (sessionId) {
        const session = await sessionsRepository.findValid(sessionId);
        // An expired or otherwise invalid session is silently treated as
        // "no one logged in" here -- unlike requireAuth, there's nothing to
        // reject. The caller just proceeds anonymous.
        if (session) req.userId = session.userId;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
