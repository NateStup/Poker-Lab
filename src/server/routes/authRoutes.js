/**
 * `/api/auth` -- signup, login, logout, and who's currently logged in.
 *
 * Owns every cookie-facing detail (name, expiry, `httpOnly`/`secure`/`sameSite`)
 * so `AuthService` can stay free of HTTP entirely, matching the split every
 * other service in this app already keeps between routes and services.
 */

import { Router } from 'express';

import { config } from '../config.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createRequireAuth, SESSION_COOKIE_NAME } from '../middleware/requireAuth.js';

/**
 * @param {{authService: import('../services/AuthService.js').AuthService, sessionsRepository: import('../store/SessionsRepository.js').SessionsRepository}} deps
 * @returns {import('express').Router}
 */
export function createAuthRouter({ authService, sessionsRepository }) {
  const router = Router();
  const requireAuth = createRequireAuth({ sessionsRepository });

  router.post('/signup', asyncHandler(async (req, res) => {
    const { user, sessionId } = await authService.signup(req.body || {});
    setSessionCookie(res, sessionId);
    res.status(201).json({ user });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const { user, sessionId } = await authService.login(req.body || {});
    setSessionCookie(res, sessionId);
    res.json({ user });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    await authService.logout(req.signedCookies[SESSION_COOKIE_NAME]);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
    res.status(204).end();
  }));

  router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    res.json({ user: await authService.currentUser(req.userId) });
  }));

  return router;
}

/**
 * @param {import('express').Response} res
 * @param {string} sessionId
 */
function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE_NAME, sessionId, { ...cookieOptions(), maxAge: config.auth.sessionTtlMs });
}

/** @returns {import('express').CookieOptions} everything but `maxAge`, shared between setting and clearing */
function cookieOptions() {
  return {
    signed: true,
    httpOnly: true,
    // 'lax' rather than 'strict': the difference only matters for a cookie
    // carried on the *first* request of a cross-site navigation (someone
    // clicking a link into this app from elsewhere), and 'strict' would drop
    // the session on that first load -- annoying for no real security gain
    // for a same-origin app with no cross-site actions worth forging.
    sameSite: 'lax',
    // Secure cookies require HTTPS, which local dev doesn't have -- this
    // flag needs to be true the moment the app is ever deployed anywhere real.
    secure: config.env === 'production',
    path: '/'
  };
}
