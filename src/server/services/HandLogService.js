/**
 * Application service for saved hands.
 *
 * Same shape as `TournamentService`: validation and state rules live here,
 * routes stay thin, and every read response is decorated with `derived` --
 * pot progression, positions, payouts, all computed by
 * `shared/handLog/actions.js`. The client renders those numbers rather than
 * recomputing them, which is what keeps a shared link showing exactly what
 * the author saw.
 */

import { computeHandDerived, furthestStreet, validateHandLogRequest } from '../../shared/handLog/index.js';
import { ApiError } from '../errors/ApiError.js';

export class HandLogService {
  /** @param {{handLogRepository: import('../store/HandLogRepository.js').HandLogRepository}} deps */
  constructor({ handLogRepository }) {
    this.repository = handLogRepository;
  }

  /**
   * @param {object} payload
   * @returns {Promise<object>} the created hand, decorated
   */
  async create(payload) {
    const { valid, errors, value } = validateHandLogRequest(payload);
    if (!valid) throw ApiError.badRequest('The hand is invalid.', errors);

    return this.#decorate(await this.repository.create(value));
  }

  /**
   * @param {{limit?: number, offset?: number}} query
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list(query) {
    const page = await this.repository.list(query);
    return { ...page, items: page.items.map(hand => this.#summarize(hand)) };
  }

  /** @param {string} id @returns {Promise<object>} */
  async get(id) {
    return this.#decorate(await this.#require(id));
  }

  /**
   * Replace a saved hand. The payload is merged over the stored record before
   * validating, so a partial edit (just the name, say) can't drop the rest of
   * the hand -- and the merged result is validated in full, so an edit can
   * never leave a record the reader would choke on.
   * @param {string} id
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async update(id, payload) {
    const existing = await this.#require(id);

    const { valid, errors, value } = validateHandLogRequest({ ...existing, ...payload });
    if (!valid) throw ApiError.badRequest('The hand is invalid.', errors);

    return this.#decorate(await this.repository.update(id, value));
  }

  /** @param {string} id @returns {Promise<boolean>} */
  async remove(id) {
    await this.#require(id);
    return this.repository.remove(id);
  }

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async #require(id) {
    const hand = await this.repository.findById(id);
    if (!hand) throw ApiError.notFound('Hand not found');
    return hand;
  }

  /** @param {object} hand @returns {object} a lightweight shape for list views */
  #summarize(hand) {
    const hero = hand.seats.find(seat => seat.isHero);
    const derived = computeHandDerived(hand);

    return {
      id: hand.id,
      name: hand.name,
      createdAt: hand.createdAt,
      updatedAt: hand.updatedAt,
      gameType: hand.format.gameType,
      seatCount: hand.seats.length,
      heroCards: hero ? hero.cards : [null, null],
      furthestStreet: furthestStreet(hand.streets),
      totalPot: derived.totalPot
    };
  }

  /** @param {object} hand @returns {object} the full record plus computed `derived` */
  #decorate(hand) {
    return { ...hand, derived: { ...computeHandDerived(hand), furthestStreet: furthestStreet(hand.streets) } };
  }
}
