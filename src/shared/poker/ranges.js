/**
 * Starting-hand range primitives.
 *
 * A "hand code" is the standard shorthand for a class of starting hands, e.g.
 * `'AKs'` (suited), `'AKo'` (offsuit), `'AA'` (pair). There are 169 of them --
 * the classic 13x13 range grid used by every range-explorer tool. This module
 * is the single source of truth for that grid and for expanding a hand code
 * into the concrete two-card combinations it represents, which is what lets
 * {@link ../poker/rangeEquity.js} sample real hands from an abstract range.
 *
 * Pure and isomorphic, like the rest of `shared/`.
 */

import { RANKS, RANK_VALUES, SUITS } from './cards.js';

/** Ranks from strongest to weakest -- the order the range grid is drawn in. */
export const RANK_ORDER = Object.freeze([...RANKS].reverse());

/**
 * The 13x13 range grid. `grid[row][col]` is the hand code for that cell; the
 * diagonal holds pairs, the upper-right triangle holds suited hands, and the
 * lower-left triangle holds offsuit hands -- the layout every range tool uses.
 * @type {ReadonlyArray<ReadonlyArray<{hand: string, type: 'pair'|'suited'|'offsuit'}>>}
 */
export const RANGE_GRID = Object.freeze(
  RANK_ORDER.map((rowRank, rowIndex) =>
    Object.freeze(
      RANK_ORDER.map((colRank, colIndex) => {
        if (rowIndex === colIndex) return Object.freeze({ hand: `${rowRank}${rowRank}`, type: 'pair' });
        if (rowIndex < colIndex) return Object.freeze({ hand: `${rowRank}${colRank}s`, type: 'suited' });
        return Object.freeze({ hand: `${colRank}${rowRank}o`, type: 'offsuit' });
      })
    )
  )
);

/** Every hand code, in grid order. 13 pairs + 78 suited + 78 offsuit = 169. */
export const ALL_HANDS = Object.freeze(RANGE_GRID.flat().map(cell => cell.hand));

const ALL_HANDS_SET = new Set(ALL_HANDS);

/**
 * Parse a hand code into its components.
 * @param {unknown} hand
 * @returns {{rankHigh: string, rankLow: string, type: 'pair'|'suited'|'offsuit'}|null}
 *   `null` if `hand` is not a canonical hand code (wrong rank order, unknown
 *   suffix, etc. are all rejected rather than silently corrected)
 */
export function parseHandCode(hand) {
  if (typeof hand !== 'string') return null;

  if (hand.length === 2) {
    const [r1, r2] = hand;
    if (r1 !== r2 || !RANKS.includes(r1)) return null;
    return { rankHigh: r1, rankLow: r2, type: 'pair' };
  }

  if (hand.length === 3) {
    const [r1, r2, suitedness] = hand;
    if (!RANKS.includes(r1) || !RANKS.includes(r2) || r1 === r2) return null;
    if (suitedness !== 's' && suitedness !== 'o') return null;
    // Canonical form always lists the higher rank first.
    if (RANK_VALUES[r1] < RANK_VALUES[r2]) return null;
    return { rankHigh: r1, rankLow: r2, type: suitedness === 's' ? 'suited' : 'offsuit' };
  }

  return null;
}

/**
 * @param {unknown} hand
 * @returns {boolean} whether `hand` is one of the 169 canonical hand codes
 */
export function isValidHandCode(hand) {
  return ALL_HANDS_SET.has(hand);
}

/**
 * Number of concrete card combinations a hand code represents.
 * @param {string} hand
 * @returns {number} 6 for a pair, 4 for suited, 12 for offsuit; 0 if invalid
 */
export function comboCount(hand) {
  const parsed = parseHandCode(hand);
  if (!parsed) return 0;
  if (parsed.type === 'pair') return 6;
  if (parsed.type === 'suited') return 4;
  return 12;
}

/** Total combinations in a full 52-card deck's worth of starting hands. */
export const TOTAL_COMBOS = 1326;

/**
 * Expand a hand code into its concrete two-card combinations.
 * @param {string} hand a canonical hand code, e.g. `'AKs'`
 * @returns {string[][]} each entry is a two-card hand, e.g. `['As', 'Ks']`
 * @throws {TypeError} if `hand` is not a canonical hand code
 */
export function handCombos(hand) {
  const parsed = parseHandCode(hand);
  if (!parsed) {
    throw new TypeError(`Not a canonical hand code: ${JSON.stringify(hand)}`);
  }
  const { rankHigh, rankLow, type } = parsed;
  const combos = [];

  if (type === 'pair') {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([`${rankHigh}${SUITS[i]}`, `${rankHigh}${SUITS[j]}`]);
      }
    }
    return combos;
  }

  if (type === 'suited') {
    for (const suit of SUITS) {
      combos.push([`${rankHigh}${suit}`, `${rankLow}${suit}`]);
    }
    return combos;
  }

  for (const suitHigh of SUITS) {
    for (const suitLow of SUITS) {
      if (suitHigh === suitLow) continue;
      combos.push([`${rankHigh}${suitHigh}`, `${rankLow}${suitLow}`]);
    }
  }
  return combos;
}

/**
 * Expand a whole range into concrete combos, deduplicated and with any combo
 * touching an excluded card (a board or dead card) removed.
 *
 * @param {string[]} handCodes canonical hand codes; duplicates are tolerated
 * @param {string[]} [excludedCards] cards a combo may not contain
 * @returns {string[][]} concrete two-card hands
 * @throws {TypeError} if any hand code is not canonical
 */
export function expandRangeToCombos(handCodes, excludedCards = []) {
  const excluded = new Set(excludedCards);
  const seen = new Set();
  const combos = [];

  for (const hand of handCodes) {
    for (const combo of handCombos(hand)) {
      if (combo.some(card => excluded.has(card))) continue;

      // Two hand codes never produce the same combo, but a caller can list the
      // same hand code twice -- dedupe defensively.
      const key = combo[0] < combo[1] ? combo.join('') : `${combo[1]}${combo[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combos.push(combo);
    }
  }

  return combos;
}

/**
 * Combo-weighted size of a range, ignoring any card-blocking. Useful for a UI
 * stat like "34 combos selected (2.6%)" -- the real, blocker-aware count used
 * for an equity calculation comes back from {@link expandRangeToCombos} instead.
 *
 * @param {string[]} handCodes
 * @returns {number}
 */
export function rangeComboCount(handCodes) {
  const unique = new Set(handCodes);
  let total = 0;
  for (const hand of unique) total += comboCount(hand);
  return total;
}
