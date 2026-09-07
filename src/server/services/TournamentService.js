/**
 * Application service for tournaments.
 *
 * Same shape as `EquityService`: routes stay thin, and this is where request
 * validation, state-transition rules (you can't rebuy a player who isn't
 * eliminated, you can't restart a running clock), and response shaping live.
 * Every read response is decorated with `derived` -- the clock reading, chip
 * counts, and payouts computed fresh from `shared/tournament/` -- so the
 * client never recomputes tournament math itself; it only renders numbers
 * the server already computed the same way it always does.
 */

import {
  activePlayerCount,
  averageStack,
  calculatePayouts,
  computeClockState,
  prizePool,
  totalChipsInPlay,
  validateCreateTournamentRequest,
  validateRegisterPlayerRequest
} from '../../shared/tournament/index.js';
import { ApiError } from '../errors/ApiError.js';

const PLAYER_ACTIONS = Object.freeze(['rebuy', 'addon', 'eliminate', 'reinstate']);
const CLOCK_ACTIONS = Object.freeze(['start', 'pause', 'resume', 'advance', 'setLevel']);
const REGISTRATION_ACTIONS = Object.freeze(['close', 'reopen']);

export class TournamentService {
  /** @param {{tournamentRepository: import('../store/TournamentRepository.js').TournamentRepository}} deps */
  constructor({ tournamentRepository }) {
    this.repository = tournamentRepository;
  }

  /**
   * @param {object} payload
   * @param {string|undefined} userId stamped as the owner if present; a
   *   tournament created with no session stays ownerless, exactly as every
   *   tournament was before accounts existed
   * @returns {Promise<object>} the created tournament, decorated
   */
  async create(payload, userId) {
    const { valid, errors, value } = validateCreateTournamentRequest(payload);
    if (!valid) throw ApiError.badRequest('The tournament settings are invalid.', errors);

    // A `payoutSplit` supplied at creation is a deliberate choice; one
    // defaulted by validation (no players registered yet) is not -- the
    // repository keeps auto-suggesting a split off the field size as players
    // register until the organizer explicitly sets one themselves.
    const payoutSplitCustomized = payload.payoutSplit !== undefined;
    // `userId` is ownership metadata, not a tournament setting, so it's
    // merged in after validation rather than run through
    // `validateCreateTournamentRequest` alongside the domain fields it
    // actually checks.
    return this.#decorate(
      await this.repository.create({ ...value, payoutSplitCustomized, userId: userId || null })
    );
  }

  /**
   * @param {{limit?: number, offset?: number, mine?: boolean}} query
   * @param {string|undefined} userId
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit, offset, mine } = {}, userId) {
    // `mine` with no session is a no-op filter, not an error -- there is
    // nothing to scope to, so the request just gets the same unfiltered page
    // anyone else would.
    const where = mine && userId ? { userId } : undefined;
    const page = await this.repository.list({ limit, offset, where });
    return { ...page, items: page.items.map(tournament => this.#summarize(tournament)) };
  }

  /** @param {string} id @returns {Promise<object>} */
  async get(id) {
    return this.#decorate(await this.#require(id));
  }

  /**
   * @param {string} id
   * @param {object} payload
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async updateSettings(id, payload, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);

    // Full settings (name, stacks, blinds, an early payout guess) are only safe
    // to change before the tournament starts. The payout split is the one
    // exception: it's meant to be *decided* once the field is final, which for
    // a tournament with late registration can be well after the clock has
    // started -- so a payout-split-only patch is allowed once registration has
    // closed, as long as the tournament isn't already decided.
    const keys = Object.keys(payload);
    const isPayoutSplitOnly = keys.length === 1 && keys[0] === 'payoutSplit';
    const canEditFullSettings = tournament.status === 'setup';
    const canFinalizePayoutSplit = isPayoutSplitOnly && !tournament.registrationOpen && tournament.status !== 'completed';

    if (!canEditFullSettings && !canFinalizePayoutSplit) {
      throw ApiError.unprocessable(
        'Settings can only be changed before the tournament starts, except the payout split, ' +
        'which can also be finalized once registration has closed.'
      );
    }

    const { valid, errors, value } = validateCreateTournamentRequest({ ...tournament, ...payload });
    if (!valid) throw ApiError.badRequest('The tournament settings are invalid.', errors);

    const payoutSplitCustomized = tournament.payoutSplitCustomized || payload.payoutSplit !== undefined;
    return this.#decorate(await this.repository.updateSettings(id, { ...value, payoutSplitCustomized }));
  }

  /**
   * @param {string} id
   * @param {string|undefined} userId
   * @returns {Promise<boolean>}
   */
  async remove(id, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);
    return this.repository.remove(id);
  }

  /**
   * @param {string} id
   * @param {object} payload
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async registerPlayer(id, payload, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);
    if (!tournament.registrationOpen) {
      throw ApiError.unprocessable('Registration is closed for this tournament.');
    }

    const { valid, errors, value } = validateRegisterPlayerRequest(payload);
    if (!valid) throw ApiError.badRequest('The player registration is invalid.', errors);

    return this.#decorate(await this.repository.registerPlayer(id, value.name));
  }

  /**
   * Close or reopen registration. Closing is what lets `updateSettings`
   * finalize the payout split against the field's actual final size -- see
   * the comment there.
   * @param {string} id
   * @param {{action: string}} payload
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async updateRegistration(id, { action } = {}, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);

    if (!REGISTRATION_ACTIONS.includes(action)) {
      throw ApiError.badRequest(`Unknown registration action: ${JSON.stringify(action)}`, [
        `action must be one of ${REGISTRATION_ACTIONS.join(', ')}`
      ]);
    }
    if (action === 'close' && !tournament.registrationOpen) {
      throw ApiError.unprocessable('Registration is already closed.');
    }
    if (action === 'reopen' && tournament.registrationOpen) {
      throw ApiError.unprocessable('Registration is already open.');
    }
    if (action === 'reopen' && tournament.status === 'completed') {
      throw ApiError.unprocessable('Registration cannot be reopened once the tournament is complete.');
    }

    const updated = action === 'close'
      ? await this.repository.closeRegistration(id)
      : await this.repository.openRegistration(id);
    return this.#decorate(updated);
  }

  /**
   * @param {string} id
   * @param {string} playerId
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async removePlayer(id, playerId, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);
    if (tournament.status !== 'setup') {
      throw ApiError.unprocessable('A player can only be removed before the tournament starts; eliminate them instead.');
    }
    this.#requirePlayer(tournament, playerId);

    return this.#decorate(await this.repository.removePlayer(id, playerId));
  }

  /**
   * @param {string} id
   * @param {string} playerId
   * @param {{action: string}} payload
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async updatePlayer(id, playerId, { action } = {}, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);
    const player = this.#requirePlayer(tournament, playerId);

    if (!PLAYER_ACTIONS.includes(action)) {
      throw ApiError.badRequest(`Unknown player action: ${JSON.stringify(action)}`, [
        `action must be one of ${PLAYER_ACTIONS.join(', ')}`
      ]);
    }
    if (action === 'eliminate' && player.eliminated) {
      throw ApiError.unprocessable('That player is already eliminated.');
    }
    if (action === 'reinstate' && !player.eliminated) {
      throw ApiError.unprocessable('That player has not been eliminated.');
    }

    const updated = await {
      rebuy: () => this.repository.recordRebuy(id, playerId),
      addon: () => this.repository.recordAddOn(id, playerId),
      eliminate: () => this.repository.eliminatePlayer(id, playerId),
      reinstate: () => this.repository.reinstatePlayer(id, playerId)
    }[action]();

    return this.#decorate(updated);
  }

  /**
   * @param {string} id
   * @param {{action: string, levelIndex?: number}} payload
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async updateClock(id, { action, levelIndex } = {}, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);

    if (!CLOCK_ACTIONS.includes(action)) {
      throw ApiError.badRequest(`Unknown clock action: ${JSON.stringify(action)}`, [
        `action must be one of ${CLOCK_ACTIONS.join(', ')}`
      ]);
    }
    if (action === 'start' && tournament.status !== 'setup') {
      throw ApiError.unprocessable('The clock has already been started.');
    }
    if ((action === 'pause' || action === 'advance') && tournament.clock.status !== 'running') {
      throw ApiError.unprocessable(`Cannot ${action} a clock that isn't running.`);
    }
    if (action === 'resume' && tournament.clock.status !== 'paused') {
      throw ApiError.unprocessable('The clock is not paused.');
    }

    if (action === 'start') return this.#decorate(await this.repository.startClock(id));
    if (action === 'pause') return this.#decorate(await this.repository.pauseClock(id));
    if (action === 'resume') return this.#decorate(await this.repository.resumeClock(id));
    if (action === 'advance') return this.#decorate(await this.repository.advanceLevel(id));

    const index = Number(levelIndex);
    if (!Number.isInteger(index) || index < 0) {
      throw ApiError.badRequest('`levelIndex` must be a non-negative integer.');
    }
    return this.#decorate(await this.repository.setLevel(id, index));
  }

  /**
   * Reset a tournament back to `setup` -- clock to level 0, every player's
   * eliminations/rebuys/add-ons cleared, roster kept. Works regardless of
   * the tournament's current status.
   * @param {string} id
   * @param {string|undefined} userId
   * @returns {Promise<object>}
   */
  async reset(id, userId) {
    const tournament = await this.#require(id);
    this.#assertMutable(tournament, userId);
    return this.#decorate(await this.repository.resetProgress(id));
  }

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async #require(id) {
    const tournament = await this.repository.findById(id);
    if (!tournament) throw ApiError.notFound('Tournament not found');
    return tournament;
  }

  /**
   * A tournament with no owner is open to anyone, matching the app's
   * behavior before accounts existed. One with an owner can only be touched
   * by that owner -- checked here, once, rather than in each mutating
   * method separately.
   *
   * This is a read-then-check, not an atomic SQL condition the way hands
   * enforce ownership (`WHERE id = $1 AND user_id = $2` in one statement).
   * That's a deliberate, smaller-stakes trade-off for a shared clock/roster
   * tool, not an oversight -- see CLAUDE.md's Tournament domain section for
   * the reasoning. A tournament reopening a brief ownership-check race is a
   * different risk profile than a private hand record doing the same.
   *
   * @param {object} tournament
   * @param {string|undefined} userId
   * @throws {ApiError} 404 if the tournament has an owner and it isn't this caller
   */
  #assertMutable(tournament, userId) {
    if (tournament.userId && tournament.userId !== userId) {
      throw ApiError.notFound('Tournament not found');
    }
  }

  /**
   * @param {object} tournament
   * @param {string} playerId
   * @returns {object}
   */
  #requirePlayer(tournament, playerId) {
    const player = tournament.players.find(entry => entry.id === playerId);
    if (!player) throw ApiError.notFound('Player not found');
    return player;
  }

  /** @param {object} tournament @returns {object} a lightweight shape for list views */
  #summarize(tournament) {
    // The list says which level a tournament is on, not just that it is
    // "active", so the clock state is computed here too. It stays a summary:
    // the current level and the clock's own status, not the whole structure
    // or the roster.
    const clock = computeClockState({ structure: tournament.structure, ...tournament.clock });

    return {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      createdAt: tournament.createdAt,
      playerCount: tournament.players.length,
      activePlayerCount: activePlayerCount(tournament.players),
      clockStatus: tournament.clock.status,
      currentLevel: clock.level,
      isFinalLevel: clock.isFinalLevel
    };
  }

  /** @param {object} tournament @returns {object} the full record plus computed `derived` stats */
  #decorate(tournament) {
    const stackSettings = {
      startingStack: tournament.startingStack,
      rebuyStack: tournament.rebuyStack,
      addOnStack: tournament.addOnStack
    };
    const moneySettings = {
      buyIn: tournament.buyIn,
      rebuyAmount: tournament.rebuyAmount,
      addOnAmount: tournament.addOnAmount
    };

    const totalChips = totalChipsInPlay(tournament.players, stackSettings);
    const activeCount = activePlayerCount(tournament.players);
    const pool = prizePool(tournament.players, moneySettings);

    return {
      ...tournament,
      derived: {
        clock: computeClockState({ structure: tournament.structure, ...tournament.clock }),
        totalChipsInPlay: totalChips,
        activePlayerCount: activeCount,
        averageStack: averageStack(totalChips, activeCount),
        prizePool: pool,
        payouts: calculatePayouts({ prizePool: pool, split: tournament.payoutSplit })
      }
    };
  }
}
