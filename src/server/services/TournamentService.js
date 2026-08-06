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

export class TournamentService {
  /** @param {{tournamentRepository: import('../store/TournamentRepository.js').TournamentRepository}} deps */
  constructor({ tournamentRepository }) {
    this.repository = tournamentRepository;
  }

  /**
   * @param {object} payload
   * @returns {Promise<object>} the created tournament, decorated
   */
  async create(payload) {
    const { valid, errors, value } = validateCreateTournamentRequest(payload);
    if (!valid) throw ApiError.badRequest('The tournament settings are invalid.', errors);

    // A `payoutSplit` supplied at creation is a deliberate choice; one
    // defaulted by validation (no players registered yet) is not -- the
    // repository keeps auto-suggesting a split off the field size as players
    // register until the organizer explicitly sets one themselves.
    const payoutSplitCustomized = payload.payoutSplit !== undefined;
    return this.#decorate(await this.repository.create({ ...value, payoutSplitCustomized }));
  }

  /**
   * @param {{limit?: number, offset?: number}} query
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list(query) {
    const page = await this.repository.list(query);
    return { ...page, items: page.items.map(tournament => this.#summarize(tournament)) };
  }

  /** @param {string} id @returns {Promise<object>} */
  async get(id) {
    return this.#decorate(await this.#require(id));
  }

  /**
   * @param {string} id
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async updateSettings(id, payload) {
    const tournament = await this.#require(id);
    if (tournament.status !== 'setup') {
      throw ApiError.unprocessable('Settings can only be changed before the tournament starts.');
    }

    const { valid, errors, value } = validateCreateTournamentRequest({ ...tournament, ...payload });
    if (!valid) throw ApiError.badRequest('The tournament settings are invalid.', errors);

    const payoutSplitCustomized = tournament.payoutSplitCustomized || payload.payoutSplit !== undefined;
    return this.#decorate(await this.repository.updateSettings(id, { ...value, payoutSplitCustomized }));
  }

  /** @param {string} id @returns {Promise<boolean>} */
  async remove(id) {
    await this.#require(id);
    return this.repository.remove(id);
  }

  /**
   * @param {string} id
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async registerPlayer(id, payload) {
    await this.#require(id);

    const { valid, errors, value } = validateRegisterPlayerRequest(payload);
    if (!valid) throw ApiError.badRequest('The player registration is invalid.', errors);

    return this.#decorate(await this.repository.registerPlayer(id, value.name));
  }

  /**
   * @param {string} id
   * @param {string} playerId
   * @returns {Promise<object>}
   */
  async removePlayer(id, playerId) {
    const tournament = await this.#require(id);
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
   * @returns {Promise<object>}
   */
  async updatePlayer(id, playerId, { action } = {}) {
    const tournament = await this.#require(id);
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
   * @returns {Promise<object>}
   */
  async updateClock(id, { action, levelIndex } = {}) {
    const tournament = await this.#require(id);

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
   * @returns {Promise<object>}
   */
  async reset(id) {
    await this.#require(id);
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
    return {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      createdAt: tournament.createdAt,
      playerCount: tournament.players.length,
      activePlayerCount: activePlayerCount(tournament.players)
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
