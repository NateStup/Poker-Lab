/**
 * Betting actions and the arithmetic derived from them.
 *
 * This is a *logger*, not a rules engine: nothing here checks that an action
 * was legal (min-raise sizing, turn order, acting after folding). A hand you
 * played is recorded as it happened, and a hand that reads oddly is the
 * user's note to themselves, not an error to reject. What this module does
 * guarantee is that the money adds up.
 *
 * The one non-obvious convention, and the reason the pot comes out right:
 * `action.amount` is the total a seat has committed **on that street** once
 * the action is done -- "raise to 300", not "put in 300 more". That is how
 * poker is spoken and how hand histories read, and it makes blinds fall out
 * for free: the big blind who calls a raise to 300 logs `call 300`, and the
 * 100 already posted is subtracted automatically rather than double-counted.
 */

import { bigBlindSeat, derivePositions, smallBlindSeat } from './positions.js';

/** @type {readonly string[]} the four streets, in dealing order */
export const STREET_NAMES = Object.freeze(['preflop', 'flop', 'turn', 'river']);

/** How many board cards each street reveals. */
export const STREET_BOARD_SIZE = Object.freeze({ preflop: 0, flop: 3, turn: 1, river: 1 });

/** @type {readonly string[]} */
export const ACTION_TYPES = Object.freeze(['fold', 'check', 'call', 'bet', 'raise']);

/** Actions that move chips, and therefore carry an `amount`. */
export const ACTION_TYPES_WITH_AMOUNT = Object.freeze(['call', 'bet', 'raise']);

/** Forced-bet kinds, in posting order. */
export const FORCED_BET_TYPES = Object.freeze(['ante', 'smallBlind', 'bigBlind', 'straddle']);

/**
 * The chips that hit the pot before anyone makes a decision.
 *
 * Derived rather than logged: blinds, antes and a straddle are fully
 * determined by the format and the button, so making the user type "SB posts
 * 50, BB posts 100, and nine antes of 25" is bookkeeping the app exists to
 * remove. Only voluntary actions are ever stored.
 *
 * @param {object} hand
 * @param {object[]} hand.seats
 * @param {number} hand.buttonSeat
 * @param {object} hand.format
 * @returns {Array<{seatNumber: number, type: string, amount: number}>}
 */
export function deriveForcedBets({ seats, buttonSeat, format }) {
  const positions = derivePositions(seats.length, buttonSeat);
  const forced = [];

  if (format.ante > 0) {
    for (const seat of seats) {
      forced.push({ seatNumber: seat.seatNumber, type: 'ante', amount: format.ante });
    }
  }

  const sb = smallBlindSeat(positions);
  if (sb !== -1 && format.smallBlind > 0) {
    forced.push({ seatNumber: sb, type: 'smallBlind', amount: format.smallBlind });
  }

  const bb = bigBlindSeat(positions);
  if (bb !== -1 && format.bigBlind > 0) {
    forced.push({ seatNumber: bb, type: 'bigBlind', amount: format.bigBlind });
  }

  if (format.straddleSeat !== null && format.straddleAmount > 0) {
    forced.push({ seatNumber: format.straddleSeat, type: 'straddle', amount: format.straddleAmount });
  }

  return forced;
}

/**
 * Every number a logged hand displays: pot progression, per-seat
 * contributions, ending stacks, and who won what.
 *
 * @param {object} hand a validated hand record
 * @returns {{
 *   positions: string[],
 *   forcedBets: Array<{seatNumber: number, type: string, amount: number}>,
 *   contributedByStreet: Record<string, number[]>,
 *   potAfterStreet: Record<string, number>,
 *   totalPot: number,
 *   contributionsBySeat: number[],
 *   stackAfterBySeat: number[],
 *   payouts: Array<{seatNumber: number, amount: number}>,
 *   netBySeat: number[]
 * }}
 */
export function computeHandDerived(hand) {
  const { seats, buttonSeat, format, streets, result } = hand;
  const seatCount = seats.length;

  const positions = derivePositions(seatCount, buttonSeat);
  const forcedBets = deriveForcedBets({ seats, buttonSeat, format });

  const contributionsBySeat = new Array(seatCount).fill(0);
  const contributedByStreet = {};
  const potAfterStreet = {};
  let runningPot = 0;

  for (const street of STREET_NAMES) {
    // Committed-so-far *on this street*, which is what `amount` is measured
    // against. Forced bets are preflop commitments, so they seed that street
    // and a big blind who later calls doesn't get charged twice.
    const committedThisStreet = new Array(seatCount).fill(0);

    if (street === 'preflop') {
      for (const bet of forcedBets) {
        committedThisStreet[bet.seatNumber] += bet.amount;
        contributionsBySeat[bet.seatNumber] += bet.amount;
        runningPot += bet.amount;
      }
    }

    for (const action of streets[street].actions) {
      if (!ACTION_TYPES_WITH_AMOUNT.includes(action.type)) continue;

      // A "to" amount below what the seat already put in this street would
      // mean chips coming back out of the pot. Nothing legal produces that,
      // but a mistyped log shouldn't be able to shrink the pot either.
      const increment = Math.max(0, action.amount - committedThisStreet[action.seatNumber]);
      committedThisStreet[action.seatNumber] += increment;
      contributionsBySeat[action.seatNumber] += increment;
      runningPot += increment;
    }

    contributedByStreet[street] = committedThisStreet;
    potAfterStreet[street] = runningPot;
  }

  const totalPot = runningPot;
  const stackAfterBySeat = seats.map((seat, index) => seat.stack - contributionsBySeat[index]);
  const payouts = splitPot(totalPot, result.winningSeats);

  // Subtracting from zero rather than negating keeps an uninvolved seat at
  // 0 instead of -0, which would otherwise leak into the API response.
  const netBySeat = new Array(seatCount).fill(0);
  for (let seatNumber = 0; seatNumber < seatCount; seatNumber += 1) {
    netBySeat[seatNumber] -= contributionsBySeat[seatNumber];
  }
  for (const payout of payouts) {
    netBySeat[payout.seatNumber] += payout.amount;
  }

  return {
    positions,
    forcedBets,
    contributedByStreet,
    potAfterStreet,
    totalPot,
    contributionsBySeat,
    stackAfterBySeat,
    payouts,
    netBySeat
  };
}

/**
 * Divide the pot among the winning seats.
 *
 * Deliberately not side-pot aware -- an all-in for less than the pot would
 * really produce a main and a side pot, and getting that right needs
 * per-street all-in tracking this logger doesn't collect. A chop divides
 * evenly and any odd chip goes to the first winning seat, matching how
 * `calculatePayouts` folds its rounding remainder into one place rather than
 * spreading it around.
 *
 * @param {number} totalPot
 * @param {number[]} winningSeats
 * @returns {Array<{seatNumber: number, amount: number}>} empty when nobody is marked as winning
 */
export function splitPot(totalPot, winningSeats) {
  if (!Array.isArray(winningSeats) || winningSeats.length === 0) return [];

  const share = Math.floor(totalPot / winningSeats.length);
  const remainder = totalPot - share * winningSeats.length;

  return winningSeats.map((seatNumber, index) => ({
    seatNumber,
    amount: index === 0 ? share + remainder : share
  }));
}

/**
 * The furthest street a hand actually reached, judged by revealed board
 * cards -- a hand that ended preflop has no flop, so "how far did this go"
 * can't be read off the action list alone (a street can legitimately have
 * zero logged actions if everyone checked and the user didn't bother).
 *
 * @param {object} streets
 * @returns {string} one of `STREET_NAMES`
 */
export function furthestStreet(streets) {
  let furthest = 'preflop';
  for (const street of STREET_NAMES) {
    if (streets[street].board.length > 0) furthest = street;
  }
  return furthest;
}
