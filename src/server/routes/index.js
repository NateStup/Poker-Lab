/**
 * API router composition.
 *
 * Every API route lives under `/api` so it can never collide with a static
 * asset path, and so a future client-side router can safely own everything
 * else.
 */

import { Router } from 'express';

import { createAuthRouter } from './authRoutes.js';
import { createEquityRouter } from './equityRoutes.js';
import { createHandLogRouter } from './handLogRoutes.js';
import { createHistoryRouter } from './historyRoutes.js';
import { createRangeRouter } from './rangeRoutes.js';
import { createSharedHandRouter } from './sharedHandRoutes.js';
import { createTournamentRouter } from './tournamentRoutes.js';

/**
 * @param {{
 *   equityService: import('../services/EquityService.js').EquityService,
 *   rangeService: import('../services/RangeService.js').RangeService,
 *   tournamentService: import('../services/TournamentService.js').TournamentService,
 *   handLogService: import('../services/HandLogService.js').HandLogService,
 *   authService: import('../services/AuthService.js').AuthService,
 *   sessionsRepository: import('../store/SessionsRepository.js').SessionsRepository,
 *   requireAuth: import('express').RequestHandler,
 *   optionalAuth: import('express').RequestHandler,
 *   historyRepository: import('../store/HistoryRepository.js').HistoryRepository
 * }} deps
 * @returns {import('express').Router}
 */
export function createApiRouter({
  equityService,
  rangeService,
  tournamentService,
  handLogService,
  authService,
  sessionsRepository,
  requireAuth,
  optionalAuth,
  historyRepository
}) {
  const router = Router();

  /** Liveness probe -- useful locally and required by most hosting platforms. */
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  router.use('/auth', createAuthRouter({ authService, sessionsRepository }));
  router.use('/equity', createEquityRouter({ equityService }));
  router.use('/ranges', createRangeRouter({ rangeService }));
  router.use('/tournaments', createTournamentRouter({ tournamentService, requireAuth, optionalAuth }));
  router.use('/hands', createHandLogRouter({ handLogService, requireAuth }));
  // Mounted at its own path, not as an exception carved out of /hands -- see
  // the header comment in sharedHandRoutes.js for why that separation matters.
  router.use('/shared-hands', createSharedHandRouter({ handLogService }));
  router.use('/history', createHistoryRouter({ historyRepository }));

  return router;
}
