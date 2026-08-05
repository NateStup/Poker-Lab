/**
 * `/api/equity` -- equity calculation endpoints.
 *
 * Routes are built by a factory that takes its dependencies as arguments. That
 * keeps them free of module-level singletons, so a test can mount a router
 * backed by a stub service without any global setup.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * @param {{equityService: import('../services/EquityService.js').EquityService}} deps
 * @returns {import('express').Router}
 */
export function createEquityRouter({ equityService }) {
  const router = Router();

  /**
   * POST /api/equity
   *
   * Body:
   *   players     string[][]  required, 2-10 hands of exactly 2 cards
   *   board       string[]    optional, 0/3/4/5 cards
   *   dead        string[]    optional, cards removed from the deck
   *   iterations  number      optional, Monte Carlo sample size (100-500000)
   *   seed        number|string optional, makes a sampled run reproducible
   *   label       string      optional, name stored with the history record
   *
   * Responds 200 with per-player equity, the method used ('exact' when the
   * remaining runouts were enumerated exhaustively), and the history record id.
   */
  router.post('/', asyncHandler(async (req, res) => {
    const result = await equityService.calculate(req.body || {});
    res.json(result);
  }));

  return router;
}
