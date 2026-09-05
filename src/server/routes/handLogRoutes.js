/**
 * `/api/hands` -- saving, reading, editing, deleting, and sharing logged hands.
 *
 * Every route here requires a session -- `router.use(requireAuth)` gates the
 * whole thing rather than each route individually, since there is no longer
 * any hand operation that makes sense without an owner attached. The public,
 * unauthenticated view of a shared hand lives elsewhere entirely, in
 * `sharedHandRoutes.js` -- not as a route on this router with auth
 * conditionally skipped, but as its own router mounted at its own path, so
 * there's no risk of a future route landing here and inheriting public
 * access by accident.
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
 * @param {{
 *   handLogService: import('../services/HandLogService.js').HandLogService,
 *   requireAuth: import('express').RequestHandler
 * }} deps
 * @returns {import('express').Router}
 */
export function createHandLogRouter({ handLogService, requireAuth }) {
  const router = Router();

  router.use(requireAuth);

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await handLogService.create(req.body || {}, req.userId));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const page = await handLogService.list(
      {
        limit: clamp(req.query.limit, 50, 1, MAX_LIMIT),
        offset: clamp(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
      },
      req.userId
    );
    res.json(page);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await handLogService.get(req.params.id, req.userId));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json(await handLogService.update(req.params.id, req.userId, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await handLogService.remove(req.params.id, req.userId);
    res.status(204).end();
  }));

  router.post('/:id/share', asyncHandler(async (req, res) => {
    res.json(await handLogService.share(req.params.id, req.userId));
  }));

  router.delete('/:id/share', asyncHandler(async (req, res) => {
    await handLogService.unshare(req.params.id, req.userId);
    res.status(204).end();
  }));

  return router;
}
