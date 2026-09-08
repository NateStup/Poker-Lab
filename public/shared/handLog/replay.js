/**
 * The replay timeline: a logged hand turned into the sequence of table states
 * someone stepping through it sees.
 *
 * `computeHandDerived` answers "how did this hand add up" -- one set of totals
 * for the finished hand. Replay answers a different question: "what did the
 * table look like at each moment", which needs the *intermediate* states that
 * the totals collapse. Rather than have the player component re-walk the
 * action list and re-do the same arithmetic (a second implementation of the
 * `amount`-is-a-street-total rule, free to drift from the first), the walk
 * happens once here and hands back a plain array of frames.
 *
 * It lives in `shared/` even though only the browser renders it: it is pure,
 * it is the same betting arithmetic the server already runs, and being here is
 * what makes it unit-testable without a DOM.
 *
 * Frames carry numbers and structured actions only -- no prose. Wording a
 * frame ("Nate raises to 300") needs names and locale-formatted chips, both of
 * which are presentation, so the player builds the sentence from the frame.
 */

import {
  ACTION_TYPES_WITH_AMOUNT,
  STREET_NAMES,
  commitIncrement,
  deriveForcedBets,
  splitPot
} from './actions.js';
import { determineWinners } from './analysis.js';

/**
 * @typedef {object} ReplayFrame
 * @property {number} index position in the timeline, 0-based
 * @property {string} street which street the hand is on
 * @property {'deal'|'action'|'result'} kind what moved: cards, chips, or the pot
 * @property {string[]} board every community card face-up at this point
 * @property {string[]} dealt the cards this frame turned over (empty unless `kind === 'deal'`)
 * @property {number[]} bets chips in front of each seat, cleared between streets
 * @property {number[]} stacks each seat's remaining stack
 * @property {number[]} committed each seat's total chips in the pot so far
 * @property {boolean[]} folded seats that are out of the hand
 * @property {Array<{type: string, amount: number}|null>} lastActions per seat, the
 *   label to show on their chips right now (`type: 'post'` for forced bets)
 * @property {number} pot everything wagered, including chips still in front of seats
 * @property {number|null} actingSeat the seat this frame belongs to, if any
 * @property {{seatNumber: number, type: string, amount: number, increment: number}|null} action
 * @property {string} notes the street's notes (the result's notes on the final frame)
 * @property {Array<{seatNumber: number, amount: number}>} payouts populated on the final frame
 * @property {number[]} winningSeats populated on the final frame
 */

/**
 * Walk a hand and produce one frame per beat: the deal of each street, each
 * logged action, and the settle at the end.
 *
 * A street appears in the timeline when it has a board or logged actions.
 * Preflop is always present -- every hand has hole cards, even the ones where
 * nobody voluntarily did anything -- and the final settle frame is too, so a
 * hand with no winner recorded still ends on a readable "here is the pot"
 * state rather than trailing off mid-street.
 *
 * @param {object} hand a validated hand record
 * @returns {ReplayFrame[]} at least two frames (the preflop deal and the settle)
 */
export function buildReplayFrames(hand) {
  const { seats, buttonSeat, format, streets, result } = hand;
  const seatCount = seats.length;
  const forcedBets = deriveForcedBets({ seats, buttonSeat, format });

  // Mutable walk state. `bets` is per-street (chips in front of a seat, which
  // is exactly what `action.amount` is measured against); `committed` is the
  // running per-seat total across the whole hand.
  const bets = new Array(seatCount).fill(0);
  const committed = new Array(seatCount).fill(0);
  const folded = new Array(seatCount).fill(false);
  let lastActions = new Array(seatCount).fill(null);
  let collected = 0;
  let board = [];

  const frames = [];

  /**
   * Copy the current walk state into a frame. Every array is copied, because
   * the walk keeps mutating them after the frame is pushed.
   * @param {object} extra frame fields specific to this beat
   * @returns {ReplayFrame}
   */
  function snapshot(extra) {
    const frame = {
      index: frames.length,
      dealt: [],
      actingSeat: null,
      action: null,
      notes: '',
      payouts: [],
      winningSeats: [],
      ...extra,
      board: [...board],
      bets: [...bets],
      committed: [...committed],
      stacks: seats.map((seat, index) => seat.stack - committed[index]),
      folded: [...folded],
      lastActions: [...lastActions],
      pot: collected + bets.reduce((sum, bet) => sum + bet, 0)
    };
    frames.push(frame);
    return frame;
  }

  /** Sweep the street's chips into the middle and clear the felt in front of
   *  the seats -- what a dealer does between streets. A fold survives the
   *  sweep (that seat stays out); every other label is only about the street
   *  just finished, so it goes. */
  function collectStreet() {
    collected += bets.reduce((sum, bet) => sum + bet, 0);
    bets.fill(0);
    lastActions = lastActions.map((last, index) => (folded[index] ? last : null));
  }

  for (const street of STREET_NAMES) {
    const { board: streetBoard, actions, notes } = streets[street];
    const isPreflop = street === 'preflop';
    if (!isPreflop && streetBoard.length === 0 && actions.length === 0) continue;

    if (isPreflop) {
      for (const bet of forcedBets) {
        // Clamped, like every commitment: a stack too short to cover the blind
        // posts what it has rather than going negative.
        const seat = bet.seatNumber;
        const increment = commitIncrement(
          bets[seat] + bet.amount,
          bets[seat],
          seats[seat].stack - committed[seat]
        );
        bets[seat] += increment;
        committed[seat] += increment;
        lastActions[seat] = { type: 'post', amount: bets[seat] };
      }
    } else {
      collectStreet();
      board = [...board, ...streetBoard];
    }

    snapshot({ street, kind: 'deal', dealt: isPreflop ? [] : [...streetBoard], notes });

    for (const action of actions) {
      // `commitIncrement` is shared with `computeHandDerived`, which is what
      // keeps a replay's running pot equal to the hand's total -- including
      // when an amount is clamped to a short stack's all-in.
      const increment = ACTION_TYPES_WITH_AMOUNT.includes(action.type)
        ? commitIncrement(
            action.amount,
            bets[action.seatNumber],
            seats[action.seatNumber].stack - committed[action.seatNumber]
          )
        : 0;

      bets[action.seatNumber] += increment;
      committed[action.seatNumber] += increment;
      if (action.type === 'fold') folded[action.seatNumber] = true;
      // A label's amount is the seat's street total after acting -- the number
      // a player would read off the chips in front of them. Folds and checks
      // move nothing, so they carry no number even when the seat has a blind
      // still out in front of it.
      lastActions[action.seatNumber] = {
        type: action.type,
        amount: ACTION_TYPES_WITH_AMOUNT.includes(action.type) ? bets[action.seatNumber] : 0
      };

      snapshot({
        street,
        kind: 'action',
        actingSeat: action.seatNumber,
        action: { ...action, increment },
        notes
      });
    }
  }

  collectStreet();
  // Read off the hand, not stated by the user -- see `determineWinners`. An
  // undetermined hand simply pays nobody, which is what the final frame then
  // shows.
  const winningSeats = determineWinners(hand);
  const payouts = splitPot(collected, winningSeats);
  const finalFrame = snapshot({
    street: lastDealtStreet(streets),
    kind: 'result',
    notes: result.notes,
    payouts,
    winningSeats
  });

  // Winners are paid at the end, so the final frame's stacks are the only ones
  // that include a payout -- everywhere earlier, the chips are still in the pot.
  for (const payout of payouts) {
    finalFrame.stacks[payout.seatNumber] += payout.amount;
  }

  return frames;
}

/**
 * The last street the hand actually reached, so the settle frame is labelled
 * with where the hand ended rather than always saying "river".
 * @param {object} streets
 * @returns {string}
 */
function lastDealtStreet(streets) {
  let last = 'preflop';
  for (const street of STREET_NAMES) {
    if (streets[street].board.length > 0 || streets[street].actions.length > 0) last = street;
  }
  return last;
}
