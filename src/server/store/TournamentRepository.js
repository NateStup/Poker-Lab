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
import { suggestPaidPlaces, suggestPayoutSplit } from '../../shared/tournament/payouts.js';

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

/**
 * The payout split suggested at tournament creation is a guess made with
 * zero players registered (`suggestPaidPlaces(0)` is always winner-take-all).
 * As long as the organizer hasn't explicitly chosen a split, keep it in sync
 * with the field size so it doesn't stay locked at 100% to first once real
 * entrants show up.
 * @param {object} current the tournament record before this player change
 * @param {object[]} players the players array after this player change
 * @returns {{payoutSplit: number[]}|{}}
 */
function suggestedPayoutPatch(current, players) {
  if (current.payoutSplitCustomized) return {};
  return { payoutSplit: suggestPayoutSplit(suggestPaidPlaces(players.length)) };
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
   *   `validateCreateTournamentRequest`), plus an optional
   *   `payoutSplitCustomized` flag (defaults to `false` -- see
   *   `suggestedPayoutPatch`)
   * @returns {Promise<object>} the stored tournament
   */
  async create(settings) {
    return this.store.insert({
      payoutSplitCustomized: false,
      ...settings,
      status: 'setup',
      registrationOpen: true,
      players: [],
      clock: emptyClock()
    });
  }

  /**
   * @param {{limit?: number, offset?: number, where?: Record<string, unknown>}} [query]
   *   `where` is forwarded to the store as-is -- see `DataStore#list` for the
   *   equality-filter shape it accepts
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit = 50, offset = 0, where } = {}) {
    return this.store.list({ limit, offset, where });
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
   * Permanently attach an owner to a previously unowned tournament. Whether
   * the caller is allowed to do that (not already someone else's, not
   * already the caller's own) is the service's call, made before this ever
   * runs -- this is just the write, the same lighter read-then-write model
   * every other ownership-adjacent change here already uses.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  async claim(id, userId) {
    return this.store.update(id, () => ({ userId }));
  }

  /**
   * @param {string} id
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async registerPlayer(id, name) {
    return this.store.update(id, current => {
      const players = [
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
      ];
      return { players, ...suggestedPayoutPatch(current, players) };
    });
  }

  /**
   * @param {string} id
   * @param {string} playerId
   * @returns {Promise<object|null>}
   */
  async removePlayer(id, playerId) {
    return this.store.update(id, current => {
      const players = current.players.filter(player => player.id !== playerId);
      return { players, ...suggestedPayoutPatch(current, players) };
    });
  }

  /**
   * Stop taking new registrations. Decoupled from the clock: many tournaments
   * run a late-registration window after the clock has already started, so
   * this can't just be inferred from `status`. Closing is also what unlocks
   * finalizing the payout split for the field's actual final size -- see
   * `TournamentService#updateSettings`.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async closeRegistration(id) {
    return this.store.update(id, () => ({ registrationOpen: false }));
  }

  /**
   * Reopen registration -- for the inevitable "closed it too early" misclick.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async openRegistration(id) {
    return this.store.update(id, () => ({ registrationOpen: true }));
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
        // A finished tournament has already paid out; registration is force-closed
        // here (not just left to the organizer) so it can't be reopened by a stale
        // client racing the completion, then have someone register into a decided event.
        return {
          status: 'completed',
          registrationOpen: false,
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

  /**
   * Reset a tournament back to `setup`: clock to level 0, every player's
   * eliminations/rebuys/add-ons cleared -- but the roster itself kept, since
   * "run the same event again with the same players" is the point, not
   * "start over from an empty room". Registration reopens along with it
   * (returning to `setup` is meaningless if new entrants still couldn't
   * register), though the organizer can close it again immediately if the
   * replay should use the same fixed field. Settings (stacks, blinds, payout
   * split) are untouched. Works from any status, including `setup` itself.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async resetProgress(id) {
    return this.store.update(id, current => ({
      status: 'setup',
      registrationOpen: true,
      clock: emptyClock(),
      players: current.players.map(player => ({
        ...player,
        rebuys: 0,
        addOns: 0,
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
