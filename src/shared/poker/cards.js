/**
 * Card primitives shared by the server and the browser.
 *
 * A card is represented as a two-character string: rank followed by suit,
 * e.g. `'As'` (ace of spades), `'Th'` (ten of hearts), `'2c'` (two of clubs).
 * This compact form keeps JSON payloads small and makes cards trivially
 * comparable, serialisable, and usable as object/Set keys.
 *
 * This module is pure: no I/O, no randomness, no environment assumptions.
 */

/** Ranks in ascending strength order. */
export const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);

/** Suit codes used inside card strings. */
export const SUITS = Object.freeze(['s', 'h', 'd', 'c']);

/** Numeric strength of each rank. Aces are high here; the wheel is handled in the evaluator. */
export const RANK_VALUES = Object.freeze({
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14
});

/** Display metadata, kept here so the server and UI agree on symbols and colours. */
export const SUIT_META = Object.freeze({
  s: Object.freeze({ code: 's', symbol: '♠', label: 'Spades', color: 'black' }),
  h: Object.freeze({ code: 'h', symbol: '♥', label: 'Hearts', color: 'red' }),
  d: Object.freeze({ code: 'd', symbol: '♦', label: 'Diamonds', color: 'red' }),
  c: Object.freeze({ code: 'c', symbol: '♣', label: 'Clubs', color: 'black' })
});

/** Number of cards on a complete board (flop + turn + river). */
export const BOARD_SIZE = 5;

/** Number of hole cards each player is dealt in Texas Hold'em. */
export const HOLE_CARD_COUNT = 2;

/**
 * Build a fresh, ordered 52-card deck.
 * @returns {string[]} every card in the standard deck
 */
export function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

/**
 * Test whether a value is a syntactically valid card string.
 * @param {unknown} card
 * @returns {boolean}
 */
export function isValidCard(card) {
  return typeof card === 'string'
    && card.length === 2
    && RANKS.includes(card[0])
    && SUITS.includes(card[1]);
}

/**
 * Normalise loose user input into a canonical card string.
 * Accepts lowercase ranks and uppercase suits (`'ah'`, `'AH'`, `'aH'` -> `'Ah'`).
 * @param {unknown} card
 * @returns {string|null} the canonical card, or `null` if it cannot be parsed
 */
export function normalizeCard(card) {
  if (typeof card !== 'string') return null;
  const trimmed = card.trim();
  if (trimmed.length !== 2) return null;

  const normalized = trimmed[0].toUpperCase() + trimmed[1].toLowerCase();
  return isValidCard(normalized) ? normalized : null;
}

/**
 * Parse a whitespace- or comma-separated string of cards.
 * @param {string} text e.g. `'As Kd'` or `'As,Kd'`
 * @returns {string[]} canonical card strings; unparseable tokens are dropped
 */
export function parseCards(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text
    .split(/[\s,]+/)
    .map(normalizeCard)
    .filter(Boolean);
}

/**
 * Numeric strength of a card's rank.
 * @param {string} card
 * @returns {number} 2-14
 */
export function cardValue(card) {
  return RANK_VALUES[card[0]];
}

/** @param {string} card @returns {string} the suit code */
export function cardSuit(card) {
  return card[1];
}

/**
 * Assemble a board from its street components, ignoring empty slots.
 * @param {{flop?: string[], turn?: string[]|string, river?: string[]|string}} streets
 * @returns {string[]} up to {@link BOARD_SIZE} cards in dealing order
 */
export function buildBoard({ flop = [], turn = [], river = [] } = {}) {
  const streets = [flop, turn, river];
  const board = [];

  for (const street of streets) {
    // Each street accepts either an array or a bare card string, so callers can
    // pass `turn: 'Jh'` without wrapping it.
    const cards = Array.isArray(street) ? street : [street];
    for (const card of cards) {
      if (card) board.push(card);
    }
  }

  return board.slice(0, BOARD_SIZE);
}

/**
 * Find cards that appear more than once across the supplied groups.
 * Used to reject deals where the same physical card was assigned twice.
 * @param {...(string[]|undefined)} groups
 * @returns {string[]} the duplicated cards, each listed once
 */
export function findDuplicateCards(...groups) {
  const seen = new Set();
  const duplicates = new Set();

  for (const group of groups) {
    for (const card of group || []) {
      if (seen.has(card)) duplicates.add(card);
      seen.add(card);
    }
  }

  return [...duplicates];
}

/**
 * Remove a set of cards from a deck.
 * @param {string[]} deck
 * @param {string[]} cardsToRemove
 * @returns {string[]} a new array; `deck` is not mutated
 */
export function removeCards(deck, cardsToRemove) {
  const excluded = new Set(cardsToRemove);
  return deck.filter(card => !excluded.has(card));
}

/**
 * Human-readable rendering of a card, e.g. `'As'` -> `'A♠'`.
 * @param {string} card
 * @returns {string}
 */
export function formatCard(card) {
  return isValidCard(card) ? `${card[0]}${SUIT_META[card[1]].symbol}` : String(card);
}

/**
 * Human-readable rendering of several cards.
 * @param {string[]} cards
 * @returns {string}
 */
export function formatCards(cards) {
  return (cards || []).map(formatCard).join(' ');
}
