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

/**
 * Points for the higher-ranked card alone, before pair/suited/gap adjustments.
 * A, K, Q, J, T score 10/8/7/6/5; everything below scores half its rank value
 * (9 -> 4.5, ..., 2 -> 1). Standard first step of the Chen Formula.
 * @param {string} rank
 * @returns {number}
 */
function highCardPoints(rank) {
  const table = { A: 10, K: 8, Q: 7, J: 6, T: 5 };
  return table[rank] ?? RANK_VALUES[rank] / 2;
}

/**
 * The Chen Formula: a classic, deterministic starting-hand strength score.
 * No simulation involved -- it's a hand-scoring heuristic poker players have
 * used by hand for decades -- which is exactly what makes it a good fit for
 * ranking all 169 hands once, cheaply, for a "top X%" range slider and for
 * baseline heat-map coloring on the range grid.
 *
 * Reference values this reproduces: AA=20, KK=16, QQ=14, AKs=12, JJ=12,
 * AKo=10, 22-55=5 (the formula's floor for any pair).
 *
 * @param {string} hand a canonical hand code
 * @returns {number}
 * @throws {TypeError} if `hand` is not a canonical hand code
 */
export function chenScore(hand) {
  const parsed = parseHandCode(hand);
  if (!parsed) {
    throw new TypeError(`Not a canonical hand code: ${JSON.stringify(hand)}`);
  }
  const { rankHigh, rankLow, type } = parsed;

  if (type === 'pair') {
    return Math.max(highCardPoints(rankHigh) * 2, 5);
  }

  let score = highCardPoints(rankHigh);
  if (type === 'suited') score += 2;

  const gap = RANK_VALUES[rankHigh] - RANK_VALUES[rankLow] - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;

  // Connectors and one-gappers below a queen can make a straight from either
  // side, which the gap penalty alone underweights.
  if (gap <= 1 && RANK_VALUES[rankHigh] < RANK_VALUES.Q) score += 1;

  return score;
}

/**
 * Every hand code ordered strongest to weakest by {@link chenScore}. This is
 * what a "top X%" range slider walks down, and what the range grid's baseline
 * tier coloring is derived from.
 * @type {ReadonlyArray<string>}
 */
export const HAND_STRENGTH_ORDER = Object.freeze(
  [...ALL_HANDS].sort((a, b) => chenScore(b) - chenScore(a) || a.localeCompare(b))
);

/** Tier names, strongest to weakest, used for the range grid's baseline coloring. */
const TIERS = Object.freeze(['strong', 'mid', 'weak']);

/**
 * Each hand code's strength tier, precomputed once since {@link chenScore}
 * never changes at runtime. Cheap O(1) lookup for rendering the grid.
 * @type {Readonly<Record<string, 'strong'|'mid'|'weak'>>}
 */
export const HAND_TIER = Object.freeze(
  Object.fromEntries(
    HAND_STRENGTH_ORDER.map((hand, index) => [
      hand,
      TIERS[Math.floor((index / HAND_STRENGTH_ORDER.length) * TIERS.length)]
    ])
  )
);

/**
 * The top `percent`% of hands by combo-weighted strength, e.g.
 * `selectTopPercent(15)` returns the classes making up the strongest ~15% of
 * the 1326 starting combos. Whole hand classes are added greedily off
 * {@link HAND_STRENGTH_ORDER} until the target combo count is reached, so the
 * result is always a set of complete grid cells, never a partial one --
 * matching how a range-percentage slider is expected to behave.
 *
 * @param {number} percent 0-100
 * @returns {string[]} hand codes
 */
export function selectTopPercent(percent) {
  const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
  const targetCombos = Math.round((clamped / 100) * TOTAL_COMBOS);

  const selected = [];
  let combos = 0;
  for (const hand of HAND_STRENGTH_ORDER) {
    if (combos >= targetCombos) break;
    selected.push(hand);
    combos += comboCount(hand);
  }
  return selected;
}
