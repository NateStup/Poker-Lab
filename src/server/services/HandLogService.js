/**
 * Application service for saved hands.
 *
 * Same shape as before, with every operation now scoped to the caller's own
 * hands -- `userId` threads through every method that used to just take an
 * `id`, and "not found" covers both "doesn't exist" and "isn't yours" with
 * no way for a caller to tell the two apart, which is the point.
 */

import { randomBytes } from 'node:crypto';

import { computeHandDerived, furthestStreet, validateHandLogRequest } from '../../shared/handLog/index.js';
import { ApiError } from '../errors/ApiError.js';

/** Bytes of entropy in a share token -- comfortably unguessable, short enough to sit in a URL. */
const SHARE_TOKEN_BYTES = 20;

export class HandLogService {
  /** @param {{handLogRepository: import('../store/HandLogRepository.js').HandLogRepository}} deps */
  constructor({ handLogRepository }) {
    this.repository = handLogRepository;
  }

  /**
   * @param {object} payload
   * @param {string} userId
   * @returns {Promise<object>} the created hand, decorated
   */
  async create(payload, userId) {
    const { valid, errors, value } = validateHandLogRequest(payload);
    if (!valid) throw ApiError.badRequest('The hand is invalid.', errors);

    return this.#decorate(await this.repository.create(value, userId));
  }

  /**
   * @param {{limit?: number, offset?: number}} query
   * @param {string} userId
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list(query, userId) {
    const page = await this.repository.listForOwner(userId, query);
    return { ...page, items: page.items.map(hand => this.#summarize(hand)) };
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async get(id, userId) {
    return this.#decorate(await this.#requireOwned(id, userId));
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async update(id, userId, payload) {
    const existing = await this.#requireOwned(id, userId);

    const { valid, errors, value } = validateHandLogRequest({ ...existing, ...payload });
    if (!valid) throw ApiError.badRequest('The hand is invalid.', errors);

    return this.#decorate(await this.repository.update(id, userId, value));
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async remove(id, userId) {
    await this.#requireOwned(id, userId);
    return this.repository.remove(id, userId);
  }

  /**
   * Generate (or replace) the hand's share token.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object>} the decorated hand, including the new `shareToken`
   */
  async share(id, userId) {
    await this.#requireOwned(id, userId);
    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    return this.#decorate(await this.repository.setShareToken(id, userId, token));
  }

  /**
   * Revoke the hand's share token, without touching the hand itself.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async unshare(id, userId) {
    await this.#requireOwned(id, userId);
    await this.repository.setShareToken(id, userId, null);
  }

  /**
   * The public, unauthenticated read -- looked up by token, never by id.
   * `shareToken` is stripped from the response: a viewer following a shared
   * link has no reason to see the value that grants them access, only the
   * owner managing the hand does.
   * @param {string} token
   * @returns {Promise<object>}
   */
  async getShared(token) {
    const hand = await this.repository.findByShareToken(token);
    if (!hand) throw ApiError.notFound('Shared hand not found');

    const decorated = this.#decorate(hand);
    delete decorated.shareToken;
    return decorated;
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async #requireOwned(id, userId) {
    const hand = await this.repository.findOwned(id, userId);
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
      totalPot: derived.totalPot,
      // Present in the owner's own list so a "shared" badge doesn't need a
      // second request per hand; absent entirely from anywhere a non-owner
      // could see it (see #getShared, which deletes it outright).
      shareToken: hand.shareToken
    };
  }

  /** @param {object} hand @returns {object} the full record plus computed `derived` */
  #decorate(hand) {
    return { ...hand, derived: { ...computeHandDerived(hand), furthestStreet: furthestStreet(hand.streets) } };
  }
}
