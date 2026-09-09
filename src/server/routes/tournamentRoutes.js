/**
 * `/api/tournaments` -- tournament creation, registration, clock, and payouts.
 *
 * Built by a dependency-taking factory, same as every other router in
 * `routes/`. State-changing player and clock actions are consolidated behind
 * a single `action` field (`PATCH .../players/:playerId`, `PATCH .../clock`)
 * rather than one endpoint per verb (`.../rebuy`, `.../pause`, ...) -- fewer
 * routes to read, and the set of legal actions is validated in one place in
 * `TournamentService` instead of being implicit in which URL was hit.
 *
 * `router.use(optionalAuth)` runs over the whole router -- not `requireAuth`,
 * since a tournament needs no account at all today and that stays true for
 * creating one, opening an unowned one, and running its clock/roster. It
 * only attaches `req.userId` when a session happens to be present, which
 * every handler below passes through to the service. Two routes are the
 * exception, and both need a real session precisely because they touch
 * ownership itself: `GET /` (the list is now unconditionally the caller's
 * own -- there is no unowned "everyone's tournaments" page to fall back to)
 * and `POST /:id/save` (claiming requires being someone). Both stack
 * `requireAuth` on top of the router-level `optionalAuth`, rather than
 * moving the whole router to `requireAuth`, so every other route keeps
 * working with no session at all.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * @param {{
 *   tournamentService: import('../services/TournamentService.js').TournamentService,
 *   requireAuth: import('express').RequestHandler,
 *   optionalAuth: import('express').RequestHandler
 * }} deps
 * @returns {import('express').Router}
 */
export function createTournamentRouter({ tournamentService, requireAuth, optionalAuth }) {
  const router = Router();

  router.use(optionalAuth);

  router.post('/', asyncHandler(async (req, res) => {
    const tournament = await tournamentService.create(req.body || {}, req.userId);
    res.status(201).json(tournament);
  }));

  router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const page = await tournamentService.list({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined
    }, req.userId);
    res.json(page);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await tournamentService.get(req.params.id, req.userId));
  }));

  /**
   * POST /api/tournaments/:id/save
   * Claim an unowned tournament for the caller, permanently.
   */
  router.post('/:id/save', requireAuth, asyncHandler(async (req, res) => {
    res.json(await tournamentService.save(req.params.id, req.userId));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updateSettings(req.params.id, req.body || {}, req.userId));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await tournamentService.remove(req.params.id, req.userId);
    res.status(204).end();
  }));

  /**
   * POST /api/tournaments/:id/reset
   * Returns the tournament to `setup` -- clock to level 0, every player's
   * eliminations/rebuys/add-ons cleared, roster kept.
   */
  router.post('/:id/reset', asyncHandler(async (req, res) => {
    res.json(await tournamentService.reset(req.params.id, req.userId));
  }));

  /**
   * PATCH /api/tournaments/:id/registration
   * Body: { action: 'close'|'reopen' }
   */
  router.patch('/:id/registration', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updateRegistration(req.params.id, req.body || {}, req.userId));
  }));

  router.post('/:id/players', asyncHandler(async (req, res) => {
    res.status(201).json(await tournamentService.registerPlayer(req.params.id, req.body || {}, req.userId));
  }));

  router.delete('/:id/players/:playerId', asyncHandler(async (req, res) => {
    res.json(await tournamentService.removePlayer(req.params.id, req.params.playerId, req.userId));
  }));

  /**
   * PATCH /api/tournaments/:id/players/:playerId
   * Body: { action: 'rebuy'|'addon'|'eliminate'|'reinstate' }
   */
  router.patch('/:id/players/:playerId', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updatePlayer(req.params.id, req.params.playerId, req.body || {}, req.userId));
  }));

  /**
   * PATCH /api/tournaments/:id/clock
   * Body: { action: 'start'|'pause'|'resume'|'advance'|'setLevel', levelIndex?: number }
   */
  router.patch('/:id/clock', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updateClock(req.params.id, req.body || {}, req.userId));
  }));

  return router;
}
