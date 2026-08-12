/**
 * Texas Hold'em hand evaluation.
 *
 * Given 5-7 cards, {@link evaluateHand} returns the best five-card hand as a
 * *score*: a category plus an ordered list of tiebreak ranks. Two scores are
 * compared lexicographically -- category first, then each tiebreak in turn --
 * which makes {@link compareHands} a total ordering with no special cases.
 *
 * The tiebreak list is always written in the order the poker rules resolve
 * ties, so e.g. a full house is `[tripsRank, pairRank]` and two pair is
 * `[highPair, lowPair, kicker]`.
 *
 * This module is pure and runs unchanged in Node and the browser.
 */

import { RANK_NAMES, RANK_VALUES, cardSuit, isValidCard } from './cards.js';

/** Hand categories, ascending in strength. */
export const HAND_CATEGORY = Object.freeze({
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8
});

/** Display names indexed by category value. */
export const HAND_CATEGORY_NAMES = Object.freeze([
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush'
]);

/** Ace-low straight (`A-2-3-4-5`) is identified by its high card, the five. */
const WHEEL_HIGH = 5;

/**
 * Locate the highest straight contained in a set of rank values.
 *
 * Handles the wheel by treating an ace as an additional rank-1 card, which is
 * why `A-2-3-4-5` resolves to a straight to the five rather than being missed.
 *
 * @param {Iterable<number>} values rank values, duplicates allowed
 * @returns {number} the high card of the best straight, or 0 if there is none
 */
export function findStraightHigh(values) {
  const present = new Set(values);
  if (present.has(RANK_VALUES.A)) present.add(1);

  for (let high = RANK_VALUES.A; high >= WHEEL_HIGH; high--) {
    let complete = true;
    for (let offset = 0; offset < 5; offset++) {
      if (!present.has(high - offset)) {
        complete = false;
        break;
      }
    }
    if (complete) return high;
  }

  return 0;
}

/**
 * Group card values by suit.
 * @param {string[]} cards
 * @returns {Map<string, number[]>} suit code -> rank values, descending
 */
function valuesBySuit(cards) {
  const groups = new Map();
  for (const card of cards) {
    const suit = cardSuit(card);
    if (!groups.has(suit)) groups.set(suit, []);
    groups.get(suit).push(RANK_VALUES[card[0]]);
  }
  for (const values of groups.values()) {
    values.sort((a, b) => b - a);
  }
  return groups;
}

/**
 * Count how many times each rank value appears.
 * @param {string[]} cards
 * @returns {Map<number, number>} rank value -> count
 */
function countsByValue(cards) {
  const counts = new Map();
  for (const card of cards) {
    const value = RANK_VALUES[card[0]];
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

/**
 * Rank values sorted by count first, then by value -- the order that matters
 * for every "n of a kind" hand.
 * @param {Map<number, number>} counts
 * @returns {Array<{value: number, count: number}>}
 */
function sortedGroups(counts) {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
}

/**
 * Highest `limit` values excluding those already used by the main combination.
 * @param {Array<{value: number, count: number}>} groups
 * @param {number[]} exclude rank values already consumed
 * @param {number} limit
 * @returns {number[]} descending kickers
 */
function pickKickers(groups, exclude, limit) {
  const excluded = new Set(exclude);
  return groups
    .filter(group => !excluded.has(group.value))
    .map(group => group.value)
    .sort((a, b) => b - a)
    .slice(0, limit);
}

/**
 * Evaluate the best five-card hand available in `cards`.
 *
 * @param {string[]} cards 5-7 canonical card strings
 * @returns {{category: number, tiebreaks: number[], name: string}} a score
 *   comparable with {@link compareHands}
 * @throws {TypeError} if the input contains an invalid or duplicated card
 */
export function evaluateHand(cards) {
  const hand = (cards || []).filter(Boolean);

  if (hand.length < 5) {
    throw new TypeError(`evaluateHand requires at least 5 cards, received ${hand.length}`);
  }
  for (const card of hand) {
    if (!isValidCard(card)) {
      throw new TypeError(`Invalid card: ${JSON.stringify(card)}`);
    }
  }
  if (new Set(hand).size !== hand.length) {
    throw new TypeError('evaluateHand received duplicate cards');
  }

  const suitGroups = valuesBySuit(hand);
  const counts = countsByValue(hand);
  const groups = sortedGroups(counts);

  // A flush needs five cards of one suit; with seven cards at most one suit can
  // qualify, so the first match is the only match.
  let flushValues = null;
  for (const values of suitGroups.values()) {
    if (values.length >= 5) {
      flushValues = values;
      break;
    }
  }

  // Straight flush must be a straight *within the flush suit*. Checking the
  // straight against all seven cards would wrongly promote a hand that holds a
  // flush and an unrelated off-suit straight.
  if (flushValues) {
    const straightFlushHigh = findStraightHigh(flushValues);
    if (straightFlushHigh) {
      return score(HAND_CATEGORY.STRAIGHT_FLUSH, [straightFlushHigh]);
    }
  }

  const quads = groups.find(group => group.count === 4);
  if (quads) {
    return score(HAND_CATEGORY.FOUR_OF_A_KIND, [quads.value, ...pickKickers(groups, [quads.value], 1)]);
  }

  // With seven cards, two sets of trips is possible; the lower set plays as the
  // pair, so it must be considered alongside genuine pairs.
  const trips = groups.filter(group => group.count === 3);
  const pairs = groups.filter(group => group.count === 2);
  if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    const bestTrips = trips[0].value;
    const pairCandidates = [...trips.slice(1), ...pairs].map(group => group.value);
    return score(HAND_CATEGORY.FULL_HOUSE, [bestTrips, Math.max(...pairCandidates)]);
  }

  if (flushValues) {
    return score(HAND_CATEGORY.FLUSH, flushValues.slice(0, 5));
  }

  const straightHigh = findStraightHigh(counts.keys());
  if (straightHigh) {
    return score(HAND_CATEGORY.STRAIGHT, [straightHigh]);
  }

  if (trips.length > 0) {
    return score(HAND_CATEGORY.THREE_OF_A_KIND, [trips[0].value, ...pickKickers(groups, [trips[0].value], 2)]);
  }

  if (pairs.length >= 2) {
    const [high, low] = [pairs[0].value, pairs[1].value];
    return score(HAND_CATEGORY.TWO_PAIR, [high, low, ...pickKickers(groups, [high, low], 1)]);
  }

  if (pairs.length === 1) {
    return score(HAND_CATEGORY.PAIR, [pairs[0].value, ...pickKickers(groups, [pairs[0].value], 3)]);
  }

  return score(HAND_CATEGORY.HIGH_CARD, pickKickers(groups, [], 5));
}

/**
 * @param {number} category
 * @param {number[]} tiebreaks
 * @returns {{category: number, tiebreaks: number[], name: string}}
 */
function score(category, tiebreaks) {
  return { category, tiebreaks, name: HAND_CATEGORY_NAMES[category] };
}

/**
 * Say a score out loud: `'Two pair, kings and queens'`.
 *
 * This lives next to the evaluator rather than in a UI helper because it reads
 * the *tiebreak layout* -- that a full house is `[trips, pair]` and two pair is
 * `[high, low, kicker]` -- and that layout is this module's invariant. A
 * consumer writing its own description would be a second place encoding it,
 * free to drift the day a category's tiebreaks change.
 *
 * It replaced a version that returned only the category (`'Two Pair'`), which
 * is the one thing a reader can already see for themselves on the board.
 *
 * @param {{category: number, tiebreaks: number[]}} handScore from {@link evaluateHand}
 * @returns {string} sentence-cased, with no trailing punctuation
 */
export function describeHand({ category, tiebreaks = [] }) {
  const one = rank => RANK_NAMES[rank].one;
  const many = rank => RANK_NAMES[rank].many;
  const [first, second] = tiebreaks;

  // Every real score has the ranks its category needs; a score built by hand
  // might not, and a missing name shouldn't take a page down over a caption.
  if (!RANK_NAMES[first]) return HAND_CATEGORY_NAMES[category] || 'Unknown';

  switch (category) {
    case HAND_CATEGORY.STRAIGHT_FLUSH:
      // The ace-high straight flush has its own name, and calling it anything
      // else at a table would get you looked at.
      return first === RANK_VALUES.A ? 'Royal flush' : `Straight flush, ${one(first)} high`;
    case HAND_CATEGORY.FOUR_OF_A_KIND:
      return `Four of a kind, ${many(first)}`;
    case HAND_CATEGORY.FULL_HOUSE:
      return `Full house, ${many(first)} full of ${many(second)}`;
    case HAND_CATEGORY.FLUSH:
      return `Flush, ${one(first)} high`;
    case HAND_CATEGORY.STRAIGHT:
      return `Straight, ${one(first)} high`;
    case HAND_CATEGORY.THREE_OF_A_KIND:
      return `Three of a kind, ${many(first)}`;
    case HAND_CATEGORY.TWO_PAIR:
      return `Two pair, ${many(first)} and ${many(second)}`;
    case HAND_CATEGORY.PAIR:
      return `Pair of ${many(first)}`;
    default:
      return `${capitalize(one(first))} high`;
  }
}

/**
 * @param {string} text
 * @returns {string}
 */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Compare two scores from {@link evaluateHand}.
 * @param {{category: number, tiebreaks: number[]}} a
 * @param {{category: number, tiebreaks: number[]}} b
 * @returns {number} 1 if `a` wins, -1 if `b` wins, 0 on a tie
 */
export function compareHands(a, b) {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;

  const length = Math.max(a.tiebreaks.length, b.tiebreaks.length);
  for (let i = 0; i < length; i++) {
    const left = a.tiebreaks[i] || 0;
    const right = b.tiebreaks[i] || 0;
    if (left !== right) return left > right ? 1 : -1;
  }

  return 0;
}

/**
 * Find the winning index (or indices, when the pot is split) among several hands.
 * @param {Array<{category: number, tiebreaks: number[]}>} scores
 * @returns {number[]} indices of the best hand(s)
 */
export function findWinners(scores) {
  let winners = [];
  let best = null;

  for (let i = 0; i < scores.length; i++) {
    if (best === null) {
      best = scores[i];
      winners = [i];
      continue;
    }

    const comparison = compareHands(scores[i], best);
    if (comparison > 0) {
      best = scores[i];
      winners = [i];
    } else if (comparison === 0) {
      winners.push(i);
    }
  }

  return winners;
}

/**
 * Convenience wrapper: evaluate two card sets and compare them directly.
 * @param {string[]} handA
 * @param {string[]} handB
 * @returns {number} 1, -1, or 0
 */
export function compareCards(handA, handB) {
  return compareHands(evaluateHand(handA), evaluateHand(handB));
}

