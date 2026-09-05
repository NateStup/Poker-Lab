/**
 * `/api/shared-hands` -- the public, unauthenticated view of a shared hand.
 *
 * A separate router at its own path, not a route on `handLogRoutes.js` with
 * auth skipped for this one case -- that router applies `requireAuth` to
 * everything it owns, and this endpoint needs to genuinely not require it,
 * for anyone, ever. Keeping it in its own file makes that true by
 * construction rather than by a comment explaining an exception.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * @param {{handLogService: import('../services/HandLogService.js').HandLogService}} deps
 * @returns {import('express').Router}
 */
export function createSharedHandRouter({ handLogService }) {
  const router = Router();

  router.get('/:token', asyncHandler(async (req, res) => {
    res.json(await handLogService.getShared(req.params.token));
  }));

  return router;
}
