/**
 * Domain-level access to the calculation history.
 *
 * A repository sits between the services and the raw store so callers speak in
 * poker terms (`recordEquityCalculation`) rather than storage terms
 * (`insert({type: ...})`). It also owns the record *shape*, which is what makes
 * a stored result meaningful months later: a run is only reproducible if the
 * seed, method, and inputs were saved alongside the numbers.
 */

/** Record type discriminators, so one collection can hold several activities. */
export const RECORD_TYPES = Object.freeze({
  EQUITY: 'equity',
  SIMULATION: 'simulation'
});

export class HistoryRepository {
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
   * Save the outcome of an equity calculation.
   *
   * @param {object} params
   * @param {object} params.request the validated request that produced the result
   * @param {object} params.result the engine's output
   * @param {string} [params.label] optional user-supplied name for the spot
   * @returns {Promise<object>} the stored record
   */
  async recordEquityCalculation({ request, result, label }) {
    return this.store.insert({
      type: RECORD_TYPES.EQUITY,
      label: label || describeSpot(request.players, result.board),
      request: {
        players: request.players,
        board: request.board,
        dead: request.dead,
        iterations: request.iterations
      },
      result: {
        players: result.players.map(player => ({
          index: player.index,
          cards: player.cards,
          equity: player.equity,
          win: player.win,
          tie: player.tie
        })),
        board: result.board,
        method: result.method,
        iterations: result.iterations,
        seed: result.seed,
        durationMs: result.durationMs
      }
    });
  }

  /**
   * Read a page of history, newest first.
   * @param {{limit?: number, offset?: number, type?: string}} [query]
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit = 20, offset = 0, type } = {}) {
    return this.store.list({
      limit,
      offset,
      where: type ? { type } : undefined
    });
  }

  /**
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return this.store.findById(id);
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    return this.store.remove(id);
  }

  /** @returns {Promise<number>} number of records removed */
  async clear() {
    return this.store.clear();
  }

  /**
   * Aggregate counts for a dashboard view.
   * @returns {Promise<{total: number, byType: Record<string, number>}>}
   */
  async stats() {
    const { items, total } = await this.store.list({ limit: Number.MAX_SAFE_INTEGER });
    const byType = {};

    for (const record of items) {
      byType[record.type] = (byType[record.type] || 0) + 1;
    }

    return { total, byType };
  }
}

/**
 * Build a readable label such as `'AsKs vs QdQh (flop AhKd7c)'`.
 * @param {string[][]} players
 * @param {string[]} board
 * @returns {string}
 */
function describeSpot(players, board) {
  const hands = players.map(hand => hand.join('')).join(' vs ');
  return board?.length ? `${hands} (board ${board.join('')})` : `${hands} (preflop)`;
}
