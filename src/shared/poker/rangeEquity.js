/**
 * Range-vs-hand and range-vs-range equity.
 *
 * `calculateEquity` (see `equity.js`) takes concrete hole cards; a range is an
 * abstract set of up to 169 hand codes, each worth several concrete combos.
 * Averaging exact per-combo equities would mean running the enumeration/sample
 * engine once per hero-combo x villain-combo pairing -- for two wide ranges
 * that's well over a million pairings before a single board card is dealt, far
 * too slow for a request.
 *
 * Instead this samples the whole spot directly: each iteration draws one combo
 * from the hero range and one from the villain side (uniformly, discarding any
 * pairing that shares a card), deals a random runout for whatever board is
 * still unknown, and scores the showdown. That is a single Monte Carlo loop
 * regardless of range width, so it costs about the same as `calculateEquity`'s
 * own sampling path. The result is always reported as `'sampled'` -- unlike
 * `calculateEquity`, there is no board-only case small enough to enumerate
 * exactly once ranges are involved.
 *
 * Pure and isomorphic, like the rest of `shared/`.
 */

import { BOARD_SIZE, createDeck, removeCards } from './cards.js';
import { clampIterations, DEFAULT_ITERATIONS } from './equity.js';
import { evaluateHand, findWinners } from './handEvaluator.js';
import { expandRangeToCombos } from './ranges.js';
import { Rng, normalizeSeed } from './rng.js';

/** Default sample size -- wider than a single-matchup calculation because
 *  range spots have more variance to average out. */
export const DEFAULT_RANGE_ITERATIONS = 20_000;

/**
 * Rejection sampling (skipping hero/villain combos that share a card) can, in
 * principle, spin without ever finding a valid pairing if both sides are
 * reduced to nearly-identical single combos. Capping attempts turns that into
 * a clear error instead of a hang.
 */
const MAX_ATTEMPTS_PER_ITERATION = 50;

/**
 * @param {string[]} a two-card hand
 * @param {string[]} b two-card hand
 * @returns {boolean} whether the hands share a physical card
 */
function sharesCard(a, b) {
  return a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1];
}

/**
 * @param {{wins: number, ties: number, share: number}} tally
 * @param {number} evaluated
 * @param {number} comboCount
 * @returns {{win: number, tie: number, equity: number, wins: number, ties: number, comboCount: number}}
 */
function buildSide(tally, evaluated, comboCount) {
  return {
    win: tally.wins / evaluated,
    tie: tally.ties / evaluated,
    equity: tally.share / evaluated,
    wins: tally.wins,
    ties: tally.ties,
    comboCount
  };
}

/**
 * Compute hero-vs-villain equity where either side (or both) is a range.
 *
 * @param {object} options
 * @param {string[]} options.heroRange hand codes, e.g. `['AA', 'AKs', 'AKo']`
 * @param {{hands: string[]}|{cards: string[]}} options.villain either a range
 *   (`hands`, same shape as `heroRange`) or a single concrete hand (`cards`,
 *   two hole cards)
 * @param {string[]} [options.board] known community cards (0, 3, 4, or 5)
 * @param {string[]} [options.dead] cards removed from the deck but not in play
 * @param {number} [options.iterations] Monte Carlo sample size
 * @param {number|string} [options.seed] seed for reproducible sampling
 * @returns {{
 *   hero: {win: number, tie: number, equity: number, wins: number, ties: number, comboCount: number},
 *   villain: {win: number, tie: number, equity: number, wins: number, ties: number, comboCount: number},
 *   board: string[],
 *   method: 'sampled',
 *   iterations: number,
 *   seed: number,
 *   durationMs: number
 * }}
 */
export function calculateRangeEquity({
  heroRange,
  villain,
  board = [],
  dead = [],
  iterations = DEFAULT_RANGE_ITERATIONS,
  seed
} = {}) {
  const startedAt = Date.now();

  if (!Array.isArray(heroRange) || heroRange.length === 0) {
    throw new TypeError('calculateRangeEquity requires a non-empty heroRange');
  }
  if (!villain || typeof villain !== 'object') {
    throw new TypeError('calculateRangeEquity requires a villain hand or range');
  }

  const knownBoard = board.filter(Boolean);
  if (knownBoard.length > BOARD_SIZE) {
    throw new TypeError(`A board holds at most ${BOARD_SIZE} cards`);
  }

  const blocked = [...knownBoard, ...dead];
  const heroCombos = expandRangeToCombos(heroRange, blocked);
  const villainCombos = Array.isArray(villain.cards)
    ? [villain.cards.slice()]
    : expandRangeToCombos(villain.hands, blocked);

  if (heroCombos.length === 0) {
    throw new RangeError('No hero combos remain once blocked cards are removed.');
  }
  if (villainCombos.length === 0) {
    throw new RangeError('No villain combos remain once blocked cards are removed.');
  }

  const resolvedSeed = normalizeSeed(seed);
  const rng = new Rng(resolvedSeed);
  const sampleSize = clampIterations(iterations ?? DEFAULT_ITERATIONS);
  const missingBoardCards = BOARD_SIZE - knownBoard.length;

  const heroTally = { wins: 0, ties: 0, share: 0 };
  const villainTally = { wins: 0, ties: 0, share: 0 };

  let evaluated = 0;

  for (let iteration = 0; iteration < sampleSize; iteration++) {
    let heroHand;
    let villainHand;
    let attempts = 0;

    do {
      heroHand = heroCombos[rng.nextInt(heroCombos.length)];
      villainHand = villainCombos[rng.nextInt(villainCombos.length)];
      attempts++;
    } while (sharesCard(heroHand, villainHand) && attempts < MAX_ATTEMPTS_PER_ITERATION);

    if (sharesCard(heroHand, villainHand)) continue;

    // Recomputing the available deck per iteration (rather than reusing one
    // array across all samples, as `equity.js` does for fixed hole cards) is
    // required here: which cards are "in play" changes every iteration since
    // the hero/villain combo itself is resampled.
    const availableCards = removeCards(createDeck(), [...heroHand, ...villainHand, ...knownBoard, ...dead]);
    const runoutBoard = knownBoard.slice();
    for (let i = 0; i < missingBoardCards; i++) {
      const j = i + rng.nextInt(availableCards.length - i);
      [availableCards[i], availableCards[j]] = [availableCards[j], availableCards[i]];
      runoutBoard.push(availableCards[i]);
    }

    const scores = [evaluateHand([...heroHand, ...runoutBoard]), evaluateHand([...villainHand, ...runoutBoard])];
    const winners = findWinners(scores);
    const potShare = 1 / winners.length;

    if (winners.includes(0)) {
      heroTally.share += potShare;
      if (winners.length === 1) heroTally.wins++; else heroTally.ties++;
    }
    if (winners.includes(1)) {
      villainTally.share += potShare;
      if (winners.length === 1) villainTally.wins++; else villainTally.ties++;
    }

    evaluated++;
  }

  if (evaluated === 0) {
    throw new RangeError('Could not find a non-conflicting hero/villain combo pairing; the ranges may be too narrow given the blocked cards.');
  }

  return {
    hero: buildSide(heroTally, evaluated, heroCombos.length),
    villain: buildSide(villainTally, evaluated, villainCombos.length),
    board: knownBoard,
    method: 'sampled',
    iterations: evaluated,
    seed: resolvedSeed,
    durationMs: Date.now() - startedAt
  };
}
