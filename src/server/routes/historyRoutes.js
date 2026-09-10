/**
 * `/api/history` -- read and manage stored calculation results.
 *
 * The history is what turns the calculator into something worth revisiting, and
 * it is the same collection the upcoming session tracker will read from.
 *
 * `router.use(optionalAuth)` runs over the whole router, the same shape
 * `tournamentRoutes.js` uses -- it only attaches `req.userId` when a session
 * happens to be present, which is enough for `GET /:id` and `DELETE /:id` to
 * let an owner through an otherwise-owned record. Listing, stats, and
 * clearing are the exception: they stack `requireAuth` on top, because unlike
 * a tournament there is no unscoped "everyone's history" mode left to fall
 * back to -- a record's owner (or lack of one) is the only thing being asked
 * about, and there's no page of *all* records to show anyone any more.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

/** Cap on page size, so a client cannot ask for the whole store at once. */
const MAX_LIMIT = 100;

/**
 * @param {{
 *   historyService: import('../services/HistoryService.js').HistoryService,
 *   requireAuth: import('express').RequestHandler,
 *   optionalAuth: import('express').RequestHandler
 * }} deps
 * @returns {import('express').Router}
 */
export function createHistoryRouter({ historyService, requireAuth, optionalAuth }) {
  const router = Router();

  router.use(optionalAuth);

  /**
   * GET /api/history?limit=&offset=&type=
   * Newest records first, scoped to the caller.
   */
  router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const limit = clamp(req.query.limit, 20, 1, MAX_LIMIT);
    const offset = clamp(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const page = await historyService.list({ limit, offset, type: req.query.type }, req.userId);
    res.json(page);
  }));

  /** GET /api/history/stats -- counts for a summary panel, scoped to the caller. */
  router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
    res.json(await historyService.stats(req.userId));
  }));

  /** GET /api/history/:id -- an unowned record is open to anyone; an owned one, only its owner. */
  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await historyService.get(req.params.id, req.userId));
  }));

  /** DELETE /api/history/:id -- same accessibility rule as the read. */
  router.delete('/:id', asyncHandler(async (req, res) => {
    await historyService.remove(req.params.id, req.userId);
    res.status(204).end();
  }));

  /** DELETE /api/history -- clear the caller's own records. */
  router.delete('/', requireAuth, asyncHandler(async (req, res) => {
    const removed = await historyService.clear(req.userId);
    res.json({ removed });
  }));

  return router;
}

/**
 * Parse a query parameter into a bounded integer.
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(raw, fallback, min, max) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
