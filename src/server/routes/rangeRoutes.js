/**
 * `/api/ranges` -- range-vs-hand and range-vs-range equity endpoints.
 *
 * Built by a dependency-taking factory, same as `equityRoutes.js`, so tests
 * can mount it with a stub service.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * @param {{rangeService: import('../services/RangeService.js').RangeService}} deps
 * @returns {import('express').Router}
 */
export function createRangeRouter({ rangeService }) {
  const router = Router();

  /**
   * POST /api/ranges/equity
   *
   * Body:
   *   heroRange   string[]  required, hand codes e.g. ['AA', 'AKs', 'AKo']
   *   villain     object    required, either { cards: string[2] } or { hands: string[] }
   *   board       string[]  optional, 0/3/4/5 cards
   *   dead        string[]  optional, cards removed from the deck
   *   iterations  number    optional, Monte Carlo sample size (100-500000)
   *   seed        number|string optional, makes the run reproducible
   *
   * Responds 200 with hero and villain equity. The result is always sampled --
   * there is no board-only case small enough to enumerate exactly once a
   * range is involved -- so `method` is always `'sampled'`.
   */
  router.post('/equity', asyncHandler(async (req, res) => {
    const result = await rangeService.calculateEquity(req.body || {});
    res.json(result);
  }));

  return router;
}
