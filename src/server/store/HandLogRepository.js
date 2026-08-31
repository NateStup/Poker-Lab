/**
 * Domain-level access to saved hands.
 *
 * Sits between `HistoryRepository` and `TournamentRepository` in spirit: a
 * hand is written once like a history record, but unlike a calculation
 * result it is *authored* -- renamed, corrected, annotated later -- so it
 * needs `update`. It doesn't need `TournamentRepository`'s many narrow
 * mutators though, because a hand is edited as a whole document in a form,
 * not one field at a time by a live event.
 */

export class HandLogRepository {
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
   * @param {object} hand a validated hand (see `validateHandLogRequest`)
   * @returns {Promise<object>} the stored hand
   */
  async create(hand) {
    return this.store.insert(hand);
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

  /**
   * Replace the editable content of a hand wholesale. The caller passes an
   * already-validated record, so this is a one-shot replace rather than a
   * read-modify-merge -- the same shape as
   * `TournamentRepository.updateSettings`.
   * @param {string} id
   * @param {object} hand
   * @returns {Promise<object|null>}
   */
  async update(id, hand) {
    return this.store.update(id, () => hand);
  }

  /** @param {string} id @returns {Promise<boolean>} */
  async remove(id) {
    return this.store.remove(id);
  }
}
