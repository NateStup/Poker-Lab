/**
 * `/api/tournaments` -- tournament creation, registration, clock, and payouts.
 *
 * Built by a dependency-taking factory, same as every other router in
 * `routes/`. State-changing player and clock actions are consolidated behind
 * a single `action` field (`PATCH .../players/:playerId`, `PATCH .../clock`)
 * rather than one endpoint per verb (`.../rebuy`, `.../pause`, ...) -- fewer
 * routes to read, and the set of legal actions is validated in one place in
 * `TournamentService` instead of being implicit in which URL was hit.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * @param {{tournamentService: import('../services/TournamentService.js').TournamentService}} deps
 * @returns {import('express').Router}
 */
export function createTournamentRouter({ tournamentService }) {
  const router = Router();

  router.post('/', asyncHandler(async (req, res) => {
    const tournament = await tournamentService.create(req.body || {});
    res.status(201).json(tournament);
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const page = await tournamentService.list({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined
    });
    res.json(page);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await tournamentService.get(req.params.id));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updateSettings(req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await tournamentService.remove(req.params.id);
    res.status(204).end();
  }));

  /**
   * POST /api/tournaments/:id/reset
   * Returns the tournament to `setup` -- clock to level 0, every player's
   * eliminations/rebuys/add-ons cleared, roster kept.
   */
  router.post('/:id/reset', asyncHandler(async (req, res) => {
    res.json(await tournamentService.reset(req.params.id));
  }));

  router.post('/:id/players', asyncHandler(async (req, res) => {
    res.status(201).json(await tournamentService.registerPlayer(req.params.id, req.body || {}));
  }));

  router.delete('/:id/players/:playerId', asyncHandler(async (req, res) => {
    res.json(await tournamentService.removePlayer(req.params.id, req.params.playerId));
  }));

  /**
   * PATCH /api/tournaments/:id/players/:playerId
   * Body: { action: 'rebuy'|'addon'|'eliminate'|'reinstate' }
   */
  router.patch('/:id/players/:playerId', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updatePlayer(req.params.id, req.params.playerId, req.body || {}));
  }));

  /**
   * PATCH /api/tournaments/:id/clock
   * Body: { action: 'start'|'pause'|'resume'|'advance'|'setLevel', levelIndex?: number }
   */
  router.patch('/:id/clock', asyncHandler(async (req, res) => {
    res.json(await tournamentService.updateClock(req.params.id, req.body || {}));
  }));

  return router;
}
