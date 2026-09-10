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
   * @param {string|null} [params.userId] the caller, if one was logged in --
   *   `null` for an anonymous calculation, exactly like a tournament created
   *   with no session
   * @returns {Promise<object>} the stored record
   */
  async recordEquityCalculation({ request, result, label, userId = null }) {
    return this.store.insert({
      type: RECORD_TYPES.EQUITY,
      userId,
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
   * @param {{limit?: number, offset?: number, type?: string, userId?: string}} [query]
   *   `userId` and `type` combine into one equality `where` -- the same
   *   mechanism `PostgresStore`/`JsonFileStore` already use for `type` alone.
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit = 20, offset = 0, type, userId } = {}) {
    const where = { ...(type ? { type } : {}), ...(userId ? { userId } : {}) };
    return this.store.list({
      limit,
      offset,
      where: Object.keys(where).length ? where : undefined
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

  /**
   * Delete only the records owned by `userId`. `DataStore#clear()` has no
   * bulk-delete-by-filter -- there's no `WHERE` a JSON file can express any
   * more efficiently than an in-memory filter -- so this reuses the two
   * primitives the store already exposes (`list` with a `where`, then
   * `remove` per id) rather than growing the store interface a new method
   * for one caller.
   * @param {string} userId
   * @returns {Promise<number>} how many records were removed
   */
  async clearOwnedBy(userId) {
    const { items } = await this.store.list({ limit: Number.MAX_SAFE_INTEGER, where: { userId } });

    let removed = 0;
    for (const record of items) {
      if (await this.store.remove(record.id)) removed += 1;
    }
    return removed;
  }

  /**
   * Aggregate counts for a dashboard view.
   * @param {{userId?: string}} [query]
   * @returns {Promise<{total: number, byType: Record<string, number>}>}
   */
  async stats({ userId } = {}) {
    const { items, total } = await this.store.list({
      limit: Number.MAX_SAFE_INTEGER,
      where: userId ? { userId } : undefined
    });
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
