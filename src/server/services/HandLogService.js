/**
 * Application service for saved hands.
 *
 * Same shape as before, with every operation now scoped to the caller's own
 * hands -- `userId` threads through every method that used to just take an
 * `id`, and "not found" covers both "doesn't exist" and "isn't yours" with
 * no way for a caller to tell the two apart, which is the point.
 *
 * Ownership is checked *by the write itself*, never by a read before it.
 * `HandLogRepository` folds the caller into every statement, so an owner-
 * scoped `UPDATE`/`DELETE` either touches the caller's own row or touches
 * nothing -- and a `SELECT` beforehand to confirm what the write is about to
 * re-confirm buys nothing except a window for the row to disappear in. Every
 * write here therefore reports its own miss through `#found`. `update` is the
 * lone exception and only half of one: it reads first for the record it has
 * to merge the patch over, and still checks the write's result afterwards.
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
    // The one method that genuinely needs the read before the write: the
    // patch is merged over the stored record, so the stored record has to be
    // in hand first. The write's own result is still checked below -- the row
    // can disappear between the two, and this is the only place that window
    // is unavoidable rather than self-inflicted.
    const existing = await this.#requireOwned(id, userId);

    const { valid, errors, value } = validateHandLogRequest({ ...existing, ...payload });
    if (!valid) throw ApiError.badRequest('The hand is invalid.', errors);

    return this.#decorate(this.#found(await this.repository.update(id, userId, value)));
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async remove(id, userId) {
    // `repository.remove` answers a boolean rather than a hand, so it does not
    // fit `#found`'s shape -- checked directly rather than wrapped in a fake
    // truthy object to force it through.
    if (!await this.repository.remove(id, userId)) throw ApiError.notFound('Hand not found');
    return true;
  }

  /**
   * Generate (or replace) the hand's share token.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object>} the decorated hand, including the new `shareToken`
   */
  async share(id, userId) {
    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    return this.#decorate(this.#found(await this.repository.setShareToken(id, userId, token)));
  }

  /**
   * Revoke the hand's share token, without touching the hand itself.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async unshare(id, userId) {
    this.#found(await this.repository.setShareToken(id, userId, null));
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
   * A miss from the repository is a 404, in one place.
   *
   * Every owner-scoped statement folds the caller into the query itself
   * (`WHERE id = $1 AND user_id = $2`), so a `null` back means the hand does
   * not exist *or* is not this caller's -- deliberately indistinguishable
   * from outside. It also covers the row vanishing between two statements,
   * which is why the writes check their own result rather than trusting a
   * read that happened earlier.
   *
   * @param {object|null} value
   * @returns {object}
   * @throws {ApiError} 404 when there is nothing there
   */
  #found(value) {
    if (!value) throw ApiError.notFound('Hand not found');
    return value;
  }

  /**
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async #requireOwned(id, userId) {
    return this.#found(await this.repository.findOwned(id, userId));
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
