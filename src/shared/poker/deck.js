/**
 * A stateful, shufflable deck.
 *
 * The equity engine deals thousands of hands per request, so this class is
 * written to be reused rather than reallocated: {@link Deck#reset} restores the
 * full 52 cards without constructing a new object, and {@link Deck#deal} pulls
 * from the end of the array so removal is O(1).
 *
 * The upcoming table simulator needs the same primitives (burn a card, deal a
 * street, muck a hand), which is why this lives in `shared/` rather than inside
 * the equity module.
 */

import { createDeck } from './cards.js';
import { Rng } from './rng.js';

export class Deck {
  /**
   * @param {object} [options]
   * @param {Rng} [options.rng] injected RNG; a fresh seeded one is created if omitted
   * @param {number|string} [options.seed] seed used when no `rng` is supplied
   * @param {string[]} [options.excluded] cards to hold out of the deck (dead cards,
   *   cards already visible on the board or in a player's hand)
   */
  constructor({ rng, seed, excluded = [] } = {}) {
    this.rng = rng || new Rng(seed);
    this.excluded = new Set(excluded);
    /** @type {string[]} remaining cards; the top of the deck is the last element */
    this.cards = [];
    this.reset();
  }

  /**
   * Restore every non-excluded card, unshuffled.
   * @returns {this}
   */
  reset() {
    this.cards.length = 0;
    for (const card of createDeck()) {
      if (!this.excluded.has(card)) this.cards.push(card);
    }
    return this;
  }

  /** @returns {number} cards left in the deck */
  get remaining() {
    return this.cards.length;
  }

  /**
   * Replace the set of held-out cards and rebuild the deck.
   * @param {string[]} cards
   * @returns {this}
   */
  exclude(cards) {
    this.excluded = new Set(cards);
    return this.reset();
  }

  /**
   * Fisher-Yates shuffle using the injected RNG.
   * @returns {this}
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  /**
   * Deal cards off the top.
   * @param {number} [count=1]
   * @returns {string[]}
   * @throws {RangeError} if the deck cannot satisfy the request
   */
  deal(count = 1) {
    if (count > this.cards.length) {
      throw new RangeError(`Cannot deal ${count} cards; only ${this.cards.length} remain`);
    }
    return this.cards.splice(this.cards.length - count, count);
  }

  /**
   * Deal a single card.
   * @returns {string}
   */
  dealOne() {
    return this.deal(1)[0];
  }

  /**
   * Draw `count` cards uniformly at random without shuffling the whole deck.
   *
   * Cheaper than `shuffle().deal(n)` when only a few cards are needed, which is
   * the common case in Monte Carlo runs where at most five board cards are
   * completed per iteration.
   *
   * @param {number} count
   * @returns {string[]}
   * @throws {RangeError} if the deck cannot satisfy the request
   */
  drawRandom(count) {
    if (count > this.cards.length) {
      throw new RangeError(`Cannot draw ${count} cards; only ${this.cards.length} remain`);
    }

    const drawn = [];
    for (let i = 0; i < count; i++) {
      const index = this.rng.nextInt(this.cards.length);
      // Swap the chosen card to the end, then pop: O(1) removal that keeps the
      // remaining cards contiguous.
      const last = this.cards.length - 1;
      [this.cards[index], this.cards[last]] = [this.cards[last], this.cards[index]];
      drawn.push(this.cards.pop());
    }
    return drawn;
  }

  /** @returns {string[]} a copy of the remaining cards */
  toArray() {
    return this.cards.slice();
  }
}
