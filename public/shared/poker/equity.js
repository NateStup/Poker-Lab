/**
 * Equity calculation for Texas Hold'em.
 *
 * Equity is a player's expected share of the pot at showdown. This module
 * computes it two ways and picks automatically:
 *
 *   - **Exact enumeration** when few board cards are unknown. Every possible
 *     runout is evaluated, so the answer has no sampling error at all. On the
 *     turn there are 44 runouts; on the flop, 990. Both are trivial to exhaust.
 *   - **Monte Carlo sampling** when the space is too large to enumerate (a
 *     preflop heads-up spot has 1,712,304 runouts). Random runouts are dealt
 *     from a seeded RNG so any result can be reproduced from its seed.
 *
 * Split pots are credited fractionally: in a three-way tie each player earns
 * one third of that runout, which keeps every player's equity summing to 1.
 *
 * Pure and isomorphic -- the browser imports this module directly from
 * `/shared/poker/equity.js`.
 */

import { BOARD_SIZE, createDeck, removeCards } from './cards.js';
import { evaluateHand, findWinners } from './handEvaluator.js';
import { Rng, normalizeSeed } from './rng.js';

/**
 * Largest number of runouts worth enumerating exhaustively. Above this the
 * engine samples instead. 200k evaluations is a few hundred milliseconds --
 * slow enough to notice, fast enough to stay inside a request.
 */
export const EXACT_ENUMERATION_LIMIT = 200_000;

/** Bounds on the Monte Carlo sample size, to keep a request from running away. */
export const MIN_ITERATIONS = 100;
export const MAX_ITERATIONS = 500_000;
export const DEFAULT_ITERATIONS = 10_000;

/**
 * Number of k-card combinations available from n cards.
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
export function combinationCount(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Yield every k-sized combination of `items`.
 *
 * Implemented as a generator over an index cursor so memory stays flat no
 * matter how many combinations are produced.
 *
 * @param {string[]} items
 * @param {number} k
 * @yields {string[]} a reused array -- copy it if you need to retain it
 */
export function* combinations(items, k) {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > items.length) return;

  const indices = Array.from({ length: k }, (_, i) => i);
  const combo = new Array(k);

  while (true) {
    for (let i = 0; i < k; i++) combo[i] = items[indices[i]];
    yield combo;

    // Advance the rightmost index that still has room, then reset those to its right.
    let position = k - 1;
    while (position >= 0 && indices[position] === items.length - k + position) {
      position--;
    }
    if (position < 0) return;

    indices[position]++;
    for (let i = position + 1; i < k; i++) {
      indices[i] = indices[i - 1] + 1;
    }
  }
}

/**
 * Running tally of wins and split-pot shares for one player.
 * Kept as a class so the simulator can extend the same accumulator shape.
 */
class EquityTally {
  constructor() {
    this.wins = 0;
    this.ties = 0;
    /** Fractional pot share, summed across runouts. */
    this.share = 0;
  }
}

/**
 * Compute each player's equity in a spot.
 *
 * @param {object} options
 * @param {string[][]} options.players hole cards, two per player, at least two players
 * @param {string[]} [options.board] known community cards (0, 3, 4, or 5)
 * @param {string[]} [options.dead] cards removed from the deck but not in play
 * @param {number} [options.iterations] Monte Carlo sample size; ignored when the
 *   spot is enumerated exactly
 * @param {number|string} [options.seed] seed for reproducible sampling
 * @param {'auto'|'exact'|'monte-carlo'} [options.method='auto'] force a strategy
 * @returns {{
 *   players: Array<{index: number, cards: string[], win: number, tie: number, equity: number, wins: number, ties: number}>,
 *   board: string[],
 *   method: 'exact'|'monte-carlo',
 *   iterations: number,
 *   seed: number|null,
 *   possibleRunouts: number,
 *   durationMs: number
 * }}
 */
export function calculateEquity({
  players,
  board = [],
  dead = [],
  iterations = DEFAULT_ITERATIONS,
  seed,
  method = 'auto'
} = {}) {
  const startedAt = Date.now();

  if (!Array.isArray(players) || players.length < 2) {
    throw new TypeError('calculateEquity requires at least two players');
  }

  const knownBoard = board.filter(Boolean);
  const missingBoardCards = BOARD_SIZE - knownBoard.length;
  if (missingBoardCards < 0) {
    throw new TypeError(`A board holds at most ${BOARD_SIZE} cards`);
  }

  // Everything visible is unavailable to future streets.
  const inPlay = [...players.flat(), ...knownBoard, ...dead];
  const availableCards = removeCards(createDeck(), inPlay);

  const possibleRunouts = combinationCount(availableCards.length, missingBoardCards);
  const useExact = method === 'exact'
    || (method === 'auto' && possibleRunouts <= EXACT_ENUMERATION_LIMIT);

  const tallies = players.map(() => new EquityTally());

  let observed;
  let resolvedSeed = null;

  if (useExact) {
    observed = runExact({ players, knownBoard, availableCards, missingBoardCards, tallies });
  } else {
    resolvedSeed = normalizeSeed(seed);
    const sampleSize = clampIterations(iterations);
    observed = runMonteCarlo({
      players,
      knownBoard,
      availableCards,
      missingBoardCards,
      tallies,
      sampleSize,
      rng: new Rng(resolvedSeed)
    });
  }

  return {
    players: players.map((cards, index) => ({
      index,
      cards,
      wins: tallies[index].wins,
      ties: tallies[index].ties,
      win: tallies[index].wins / observed,
      tie: tallies[index].ties / observed,
      equity: tallies[index].share / observed
    })),
    board: knownBoard,
    method: useExact ? 'exact' : 'monte-carlo',
    iterations: observed,
    seed: resolvedSeed,
    possibleRunouts,
    durationMs: Date.now() - startedAt
  };
}

/**
 * Clamp a requested sample size into the supported range.
 * @param {unknown} iterations
 * @returns {number}
 */
export function clampIterations(iterations) {
  const parsed = Number.parseInt(iterations, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ITERATIONS;
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, parsed));
}

/**
 * Score one completed board against every player and update the tallies.
 * @param {string[][]} players
 * @param {string[]} board a complete five-card board
 * @param {EquityTally[]} tallies
 */
function scoreRunout(players, board, tallies) {
  const scores = players.map(hole => evaluateHand([...hole, ...board]));
  const winners = findWinners(scores);
  const potShare = 1 / winners.length;

  for (const winner of winners) {
    tallies[winner].share += potShare;
    if (winners.length === 1) {
      tallies[winner].wins++;
    } else {
      tallies[winner].ties++;
    }
  }
}

/**
 * Enumerate every remaining runout.
 * @returns {number} the number of runouts evaluated
 */
function runExact({ players, knownBoard, availableCards, missingBoardCards, tallies }) {
  let evaluated = 0;

  for (const fill of combinations(availableCards, missingBoardCards)) {
    scoreRunout(players, [...knownBoard, ...fill], tallies);
    evaluated++;
  }

  return evaluated;
}

/**
 * Sample runouts at random.
 * @returns {number} the number of runouts evaluated
 */
function runMonteCarlo({ players, knownBoard, availableCards, missingBoardCards, tallies, sampleSize, rng }) {
  // One scratch copy of the deck, reshuffled in place each iteration. Avoids
  // allocating a fresh 45-element array per sample.
  const deck = availableCards.slice();
  const board = new Array(BOARD_SIZE);
  for (let i = 0; i < knownBoard.length; i++) board[i] = knownBoard[i];

  for (let iteration = 0; iteration < sampleSize; iteration++) {
    // Partial Fisher-Yates: only the cards we actually deal need to be placed.
    for (let i = 0; i < missingBoardCards; i++) {
      const j = i + rng.nextInt(deck.length - i);
      [deck[i], deck[j]] = [deck[j], deck[i]];
      board[knownBoard.length + i] = deck[i];
    }
    scoreRunout(players, board, tallies);
  }

  return sampleSize;
}
