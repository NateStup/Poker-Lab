/**
 * Reading a logged hand as a *poker situation*, not just as arithmetic.
 *
 * Everything else in this directory is deliberately incurious about poker --
 * it records what happened and adds the money up (see `actions.js`). This
 * module is the one place that looks at a hand and asks poker questions: is
 * anyone drawing dead-money-free with cards to come, and what did the players
 * who saw it through actually have?
 *
 * That is still not a rules engine -- nothing here validates or corrects a
 * log, and no action is ever rejected for being strange. What it adds is the
 * *analysis* a shared hand is opened for: at an all-in, who has what equity;
 * at a showdown, what each hand was; and, at the end, who the pot goes to.
 *
 * That last one used to be the user's job (`result.winningSeats`) and is now
 * derived. A hand already records the folds, the board and the holdings, which
 * is everything the question needs -- asking for the winner on top was asking
 * for the same fact twice with nothing keeping the two answers in agreement.
 * The tradeoff is real and deliberate: when the cards genuinely don't say
 * (a villain who mucked unseen), `determineWinners` returns nothing rather
 * than guessing, and the UI asks for the missing holding.
 *
 * It imports the evaluator and equity engine from `shared/poker/` for the same
 * reason `handLog/` already imports card helpers: both are pure, and the
 * alternative is a second evaluator, which is the exact split this directory
 * exists to prevent.
 */

import { BOARD_SIZE, HOLE_CARD_COUNT } from '../poker/cards.js';
import { calculateEquity } from '../poker/equity.js';
import { describeHand, evaluateHand, findWinners } from '../poker/handEvaluator.js';

/**
 * Fixed seed for any equity that has to be sampled (a preflop all-in has 1.7M
 * runouts). Replaying the same hand twice must not show two different numbers,
 * and a stable seed is cheaper than caching to get that.
 */
const EQUITY_SEED = 'hand-replay';

/** Sample size when a spot is too big to enumerate. Small enough to stay
 *  responsive in the browser on every step of a replay. */
const EQUITY_ITERATIONS = 12000;

/**
 * The seats still in the hand at a given frame.
 * @param {object} frame a `buildReplayFrames` frame
 * @returns {number[]} seat numbers, ascending
 */
export function liveSeats(frame) {
  const seats = [];
  frame.folded.forEach((hasFolded, seatNumber) => {
    if (!hasFolded) seats.push(seatNumber);
  });
  return seats;
}

/**
 * A seat is all in when everything it started with is in the middle. Nothing
 * logs an all-in explicitly -- the logger records amounts, not intentions --
 * so it is read off the stack, with the `committed` check keeping a seat that
 * was simply recorded with no chips from counting as one.
 *
 * @param {object} frame
 * @returns {number[]} seat numbers, ascending
 */
export function allInSeats(frame) {
  return liveSeats(frame).filter(seat => frame.stacks[seat] <= 0 && frame.committed[seat] > 0);
}

/**
 * Is the hand past betting and simply being dealt out?
 *
 * Three things have to hold, and the third is the one that is easy to miss:
 *
 * 1. Someone is all in.
 * 2. At most one live seat still has chips. "Everyone all in" is how this is
 *    usually said, but a player whose shove is called by a bigger stack is in
 *    exactly the same run-out -- there is nobody left for that bigger stack to
 *    bet at.
 * 3. The betting is actually *matched*. Without this, a shove that is still
 *    facing a decision looks identical to one that has been called: the seat
 *    yet to act is the only one with chips either way. Getting this wrong
 *    turns the villain's cards face up while the hero is still deciding
 *    whether to call them, which gives away the one thing a replay exists to
 *    make you sit with.
 *
 * Deliberately says nothing about the board or about which cards are known, so
 * it stays true right through the river -- which is what lets cards that were
 * turned over stay turned over instead of flipping back down on the last
 * street.
 *
 * @param {object} frame a `buildReplayFrames` frame
 * @returns {boolean}
 */
export function isRunoutSpot(frame) {
  const live = liveSeats(frame);
  if (live.length < 2) return false;
  if (allInSeats(frame).length === 0) return false;
  if (live.filter(seat => frame.stacks[seat] > 0).length > 1) return false;

  // A seat with chips left has to have matched the biggest bet out there; a
  // seat with none can't, and isn't being asked to.
  const highestBet = Math.max(...live.map(seat => frame.bets[seat]));
  return live.every(seat => frame.stacks[seat] <= 0 || frame.bets[seat] >= highestBet);
}

/**
 * A run-out with cards still to come and enough known holdings to price it --
 * the spot where equity is worth showing.
 *
 * @param {object} hand a validated hand record
 * @param {object} frame a `buildReplayFrames` frame
 * @returns {{seats: number[], cardsToCome: number}|null} null when the hand
 *   isn't running out, the board is already complete, or too few of the
 *   holdings are known to say anything
 */
export function findAllInRunout(hand, frame) {
  const cardsToCome = BOARD_SIZE - frame.board.length;
  if (cardsToCome <= 0 || !isRunoutSpot(frame)) return null;

  // Equity needs two known cards a side; a hand logged with an unknown villain
  // holding simply has no equity to report, which is not an error.
  const known = liveSeats(frame)
    .filter(seat => hand.seats[seat].cards.filter(Boolean).length === HOLE_CARD_COUNT);
  if (known.length < 2) return null;

  return { seats: known, cardsToCome };
}

/**
 * Each seat's chance of winning the pot from here, for a run-out found by
 * {@link findAllInRunout}.
 *
 * @param {object} hand
 * @param {object} frame
 * @param {{seats: number[]}} runout
 * @returns {{seats: Array<{seatNumber: number, cards: string[], equity: number, win: number, tie: number}>, method: string}}
 */
export function runoutEquity(hand, frame, runout) {
  const result = calculateEquity({
    players: runout.seats.map(seat => hand.seats[seat].cards.filter(Boolean)),
    board: frame.board,
    iterations: EQUITY_ITERATIONS,
    seed: EQUITY_SEED
  });

  return {
    // `method` matters to anyone reading the number: "exact" and "sampled" are
    // different claims, and the odds calculator surfaces the same distinction.
    method: result.method,
    seats: result.players.map((player, index) => ({
      seatNumber: runout.seats[index],
      cards: player.cards,
      equity: player.equity,
      win: player.win,
      tie: player.tie
    }))
  };
}

/**
 * The seats actually contesting the pot at the end of the hand.
 *
 * Two ways to not be one: fold, or never appear. The second is the one that
 * matters in practice -- hands are reconstructed from memory and people log
 * the action that mattered, not six preflop folds -- so **a seat that never
 * acts and has no cards logged is treated as not in the hand**. Without that,
 * a perfectly clear "I raised, everyone folded, I took it down" would read as
 * six players still live and the pot could never be awarded.
 *
 * A seat that posted a blind and then vanishes from the log counts as out, and
 * its blind stays in the pot -- which is exactly what happened at the table.
 *
 * @param {object} hand a validated hand record
 * @returns {number[]} seat numbers, ascending
 */
export function contestingSeats(hand) {
  const folded = new Array(hand.seats.length).fill(false);
  const acted = new Array(hand.seats.length).fill(false);

  // Street order is irrelevant to both questions, which is what keeps this
  // module free of a dependency on `actions.js` -- which depends on this one.
  for (const street of Object.values(hand.streets)) {
    for (const action of street.actions) {
      if (action.type === 'fold') folded[action.seatNumber] = true;
      else acted[action.seatNumber] = true;
    }
  }

  return hand.seats
    .map((_seat, index) => index)
    .filter(seat => !folded[seat] && (acted[seat] || hand.seats[seat].cards.some(Boolean)));
}

/**
 * Who wins the pot, read off the hand itself.
 *
 * Three cases, in the order they settle a real hand:
 *
 * 1. One seat left contesting it (see `contestingSeats`) — that seat wins, and
 *    no cards are needed. This is how most hands end.
 * 2. Two or more seats saw a complete board with every holding logged — the
 *    best hand wins, and `findWinners` handles a chop.
 * 3. Anything else — nothing is returned. A hand cut short before the river,
 *    or one where a villain's cards were never written down, genuinely does
 *    not say who won, and inventing an answer would be worse than admitting
 *    it: the pot shows as unawarded and the UI asks for what's missing.
 *
 * @param {object} hand a validated hand record
 * @returns {number[]} winning seat numbers, ascending; empty when undetermined
 */
export function determineWinners(hand) {
  const live = contestingSeats(hand);
  if (live.length === 1) return live;

  const boardSize = Object.values(hand.streets).reduce((size, street) => size + street.board.length, 0);
  if (live.length < 2 || boardSize < BOARD_SIZE) return [];

  const known = live.filter(seat => hand.seats[seat].cards.filter(Boolean).length === HOLE_CARD_COUNT);
  if (known.length !== live.length) return [];

  const board = Object.values(hand.streets).flatMap(street => street.board);
  const scores = live.map(seat => evaluateHand([...hand.seats[seat].cards, ...board]));
  return findWinners(scores).map(index => live[index]);
}

/**
 * What the hands were, once the board is complete and more than one player is
 * left to show one.
 *
 * Uses the same seat set as `determineWinners` -- every seat still contesting
 * the pot, all of which must have both cards logged. Anything looser and this
 * panel could name a winner for a pot that `determineWinners` refuses to
 * award, which is the sort of two-answers-to-one-question split the hand this
 * describes would be the last place to want it.
 *
 * @param {object} hand
 * @param {object} frame the final frame of a replay, for the completed board
 * @returns {{
 *   seats: Array<{seatNumber: number, cards: string[], score: object, description: string, isWinner: boolean}>,
 *   winningSeats: number[]
 * }|null} null when the hand never reached a showdown, or when the cards
 *   needed to evaluate one weren't logged
 */
export function evaluateShowdown(hand, frame) {
  if (frame.board.length < BOARD_SIZE) return null;

  const shown = contestingSeats(hand);
  if (shown.length < 2) return null;
  if (!shown.every(seat => hand.seats[seat].cards.filter(Boolean).length === HOLE_CARD_COUNT)) return null;

  const scores = shown.map(seat => evaluateHand([...hand.seats[seat].cards.filter(Boolean), ...frame.board]));
  const winnerIndexes = findWinners(scores);
  const winningSeats = winnerIndexes.map(index => shown[index]);

  return {
    seats: shown.map((seatNumber, index) => ({
      seatNumber,
      cards: hand.seats[seatNumber].cards.filter(Boolean),
      score: scores[index],
      description: describeHand(scores[index]),
      isWinner: winningSeats.includes(seatNumber)
    })),
    winningSeats
  };
}
