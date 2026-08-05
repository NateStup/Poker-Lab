/**
 * `/api/history` -- read and manage stored calculation results.
 *
 * The history is what turns the calculator into something worth revisiting, and
 * it is the same collection the upcoming session tracker will read from.
 */

import { Router } from 'express';

import { ApiError } from '../errors/ApiError.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Cap on page size, so a client cannot ask for the whole store at once. */
const MAX_LIMIT = 100;

/**
 * @param {{historyRepository: import('../store/HistoryRepository.js').HistoryRepository}} deps
 * @returns {import('express').Router}
 */
export function createHistoryRouter({ historyRepository }) {
  const router = Router();

  /**
   * GET /api/history?limit=&offset=&type=
   * Newest records first.
   */
  router.get('/', asyncHandler(async (req, res) => {
    const limit = clamp(req.query.limit, 20, 1, MAX_LIMIT);
    const offset = clamp(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const page = await historyRepository.list({ limit, offset, type: req.query.type });
    res.json(page);
  }));

  /** GET /api/history/stats -- counts for a summary panel. */
  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await historyRepository.stats());
  }));

  /** GET /api/history/:id */
  router.get('/:id', asyncHandler(async (req, res) => {
    const record = await historyRepository.findById(req.params.id);
    if (!record) throw ApiError.notFound(`No history record with id ${req.params.id}`);
    res.json(record);
  }));

  /** DELETE /api/history/:id */
  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = await historyRepository.remove(req.params.id);
    if (!removed) throw ApiError.notFound(`No history record with id ${req.params.id}`);
    res.status(204).end();
  }));

  /** DELETE /api/history -- clear the collection. */
  router.delete('/', asyncHandler(async (_req, res) => {
    const removed = await historyRepository.clear();
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
