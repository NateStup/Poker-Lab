/**
 * `/api/hands` -- saving, reading, editing and deleting logged hands.
 *
 * Plain REST, unlike the tournament router's consolidated `action` field:
 * a hand is edited as one document, so there is no set of named verbs to
 * fold into a single endpoint. Built by the same dependency-taking factory
 * as every other router here.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

const MAX_LIMIT = 100;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/**
 * @param {{handLogService: import('../services/HandLogService.js').HandLogService}} deps
 * @returns {import('express').Router}
 */
export function createHandLogRouter({ handLogService }) {
  const router = Router();

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await handLogService.create(req.body || {}));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const page = await handLogService.list({
      limit: clamp(req.query.limit, 50, 1, MAX_LIMIT),
      offset: clamp(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    });
    res.json(page);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await handLogService.get(req.params.id));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json(await handLogService.update(req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await handLogService.remove(req.params.id);
    res.status(204).end();
  }));

  return router;
}
