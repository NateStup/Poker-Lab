/**
 * Domain-level access to tournaments.
 *
 * Mirrors `HistoryRepository`'s role (callers speak in tournament terms --
 * `registerPlayer`, `eliminatePlayer` -- rather than storage terms), but
 * unlike a history record a tournament is mutated constantly after creation:
 * players register mid-event, the clock advances, players bust. That's what
 * `DataStore#update` (a read-modify-write against the *current* stored value)
 * is for, and every method here is a thin, named wrapper around one.
 */

import { randomUUID } from 'node:crypto';

/** @returns {{currentLevelIndex: number, status: 'paused'|'running', levelStartedAt: number|null, pausedElapsedMs: number}} */
function emptyClock() {
  return { currentLevelIndex: 0, status: 'paused', levelStartedAt: null, pausedElapsedMs: 0 };
}

/**
 * @param {object[]} players
 * @param {string} playerId
 * @param {(player: object) => object} fn
 * @returns {object[]}
 */
function mapPlayer(players, playerId, fn) {
  return players.map(player => (player.id === playerId ? fn(player) : player));
}

export class TournamentRepository {
  /** @param {import('./DataStore.js').DataStore} store */
  constructor(store) {
    this.store = store;
  }

  /** @returns {Promise<this>} */
  async init() {
    await this.store.init();
    return this;
  }

  /**
   * @param {object} settings validated tournament settings (see
   *   `validateCreateTournamentRequest`)
   * @returns {Promise<object>} the stored tournament
   */
  async create(settings) {
    return this.store.insert({
      ...settings,
      status: 'setup',
      players: [],
      clock: emptyClock()
    });
  }

  /**
   * @param {{limit?: number, offset?: number}} [query]
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit = 50, offset = 0 } = {}) {
    return this.store.list({ limit, offset });
  }

  /** @param {string} id @returns {Promise<object|null>} */
  async findById(id) {
    return this.store.findById(id);
  }

  /** @param {string} id @returns {Promise<boolean>} */
  async remove(id) {
    return this.store.remove(id);
  }

  /**
   * Update editable settings (name, stack/money amounts, blind structure,
   * payout split). Whether that's still allowed at the tournament's current
   * status is the service's call, not the repository's.
   * @param {string} id
   * @param {object} patch
   * @returns {Promise<object|null>}
   */
  async updateSettings(id, patch) {
    return this.store.update(id, () => patch);
  }

  /**
   * @param {string} id
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async registerPlayer(id, name) {
    return this.store.update(id, current => ({
      players: [
        ...current.players,
        {
          id: randomUUID(),
          name,
          rebuys: 0,
          addOns: 0,
          eliminated: false,
          eliminatedAt: null,
          place: null,
          registeredAt: new Date().toISOString()
        }
      ]
    }));
  }

  /**
   * @param {string} id
   * @param {string} playerId
   * @returns {Promise<object|null>}
   */
  async removePlayer(id, playerId) {
    return this.store.update(id, current => ({
      players: current.players.filter(player => player.id !== playerId)
    }));
  }

  /** @param {string} id @param {string} playerId @returns {Promise<object|null>} */
  async recordRebuy(id, playerId) {
    return this.store.update(id, current => ({
      players: mapPlayer(current.players, playerId, player => ({ ...player, rebuys: player.rebuys + 1 }))
    }));
  }

  /** @param {string} id @param {string} playerId @returns {Promise<object|null>} */
  async recordAddOn(id, playerId) {
    return this.store.update(id, current => ({
      players: mapPlayer(current.players, playerId, player => ({ ...player, addOns: player.addOns + 1 }))
    }));
  }

  /**
   * Eliminate a player, assigning their finishing place by counting down from
   * the total entrant count. Once only one player remains, they're the
   * winner (place 1) and the tournament is marked complete -- no separate
   * "end tournament" step needed for the common case.
   * @param {string} id
   * @param {string} playerId
   * @returns {Promise<object|null>}
   */
  async eliminatePlayer(id, playerId) {
    return this.store.update(id, current => {
      const totalEntrants = current.players.length;
      const alreadyEliminated = current.players.filter(player => player.eliminated).length;
      const place = totalEntrants - alreadyEliminated;

      const players = mapPlayer(current.players, playerId, player => ({
        ...player,
        eliminated: true,
        eliminatedAt: new Date().toISOString(),
        place
      }));

      const stillActive = players.filter(player => !player.eliminated);
      if (stillActive.length === 1) {
        return {
          status: 'completed',
          players: mapPlayer(players, stillActive[0].id, player => ({ ...player, place: 1 }))
        };
      }

      return { players };
    });
  }

  /**
   * Undo an elimination -- for the inevitable misclick.
   * @param {string} id
   * @param {string} playerId
   * @returns {Promise<object|null>}
   */
  async reinstatePlayer(id, playerId) {
    return this.store.update(id, current => ({
      status: current.status === 'completed' ? 'active' : current.status,
      players: mapPlayer(current.players, playerId, player => ({
        ...player,
        eliminated: false,
        eliminatedAt: null,
        place: null
      }))
    }));
  }

  /** @param {string} id @returns {Promise<object|null>} */
  async startClock(id) {
    return this.store.update(id, current => ({
      status: 'active',
      clock: { ...current.clock, status: 'running', levelStartedAt: Date.now() }
    }));
  }

  /** @param {string} id @returns {Promise<object|null>} */
  async pauseClock(id) {
    return this.store.update(id, current => {
      const now = Date.now();
      const elapsedThisRun =
        current.clock.status === 'running' && current.clock.levelStartedAt !== null
          ? now - current.clock.levelStartedAt
          : 0;

      return {
        clock: {
          ...current.clock,
          status: 'paused',
          levelStartedAt: null,
          pausedElapsedMs: current.clock.pausedElapsedMs + elapsedThisRun
        }
      };
    });
  }

  /** @param {string} id @returns {Promise<object|null>} */
  async resumeClock(id) {
    return this.store.update(id, current => ({
      clock: { ...current.clock, status: 'running', levelStartedAt: Date.now() }
    }));
  }

  /**
   * Advance to the next blind level, resetting the in-level clock.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async advanceLevel(id) {
    return this.store.update(id, current => ({
      clock: {
        ...current.clock,
        currentLevelIndex: Math.min(current.clock.currentLevelIndex + 1, current.structure.length - 1),
        levelStartedAt: current.clock.status === 'running' ? Date.now() : null,
        pausedElapsedMs: 0
      }
    }));
  }

  /**
   * Jump directly to a level -- for correcting a misclick or skipping ahead.
   * @param {string} id
   * @param {number} levelIndex
   * @returns {Promise<object|null>}
   */
  async setLevel(id, levelIndex) {
    return this.store.update(id, current => ({
      clock: {
        ...current.clock,
        currentLevelIndex: Math.max(0, Math.min(levelIndex, current.structure.length - 1)),
        levelStartedAt: current.clock.status === 'running' ? Date.now() : null,
        pausedElapsedMs: 0
      }
    }));
  }
}
