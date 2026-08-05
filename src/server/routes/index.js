/**
 * API router composition.
 *
 * Every API route lives under `/api` so it can never collide with a static
 * asset path, and so a future client-side router can safely own everything
 * else.
 */

import { Router } from 'express';

import { createEquityRouter } from './equityRoutes.js';
import { createHistoryRouter } from './historyRoutes.js';
import { createRangeRouter } from './rangeRoutes.js';

/**
 * @param {{
 *   equityService: import('../services/EquityService.js').EquityService,
 *   rangeService: import('../services/RangeService.js').RangeService,
 *   historyRepository: import('../store/HistoryRepository.js').HistoryRepository
 * }} deps
 * @returns {import('express').Router}
 */
export function createApiRouter({ equityService, rangeService, historyRepository }) {
  const router = Router();

  /** Liveness probe -- useful locally and required by most hosting platforms. */
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  router.use('/equity', createEquityRouter({ equityService }));
  router.use('/ranges', createRangeRouter({ rangeService }));
  router.use('/history', createHistoryRouter({ historyRepository }));

  return router;
}
