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

import { determineWinners } from './analysis.js';
import { actingOrder, bigBlindSeat, derivePositions, smallBlindSeat } from './positions.js';

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
 * The chips an action actually moves, given what the seat has already put in
 * this street and what it has left.
 *
 * Two clamps, and both exist because a hand typed from memory is allowed to be
 * wrong in ways a real hand can't be:
 *
 * - A "to" amount *below* what the seat already committed would mean chips
 *   coming back out of the pot. Nothing legal produces that; a mistyped log
 *   shouldn't be able to shrink the pot either.
 * - A "to" amount *above* what the seat has left is an all-in. A player cannot
 *   bet chips they don't have, so logging "raise to 5000" with 600 behind puts
 *   600 in and leaves the stack at zero -- rather than the negative stack it
 *   used to produce, which then showed up as a seat playing on with less than
 *   nothing for the rest of the replay.
 *
 * Every walk over the action list goes through here, so the three of them
 * (`computeHandDerived`, `buildReplayFrames`, `streetBettingState`) cannot
 * disagree about what a given action cost.
 *
 * @param {number} amount the action's `amount` (a street total)
 * @param {number} alreadyCommitted what the seat has out on this street already
 * @param {number} remainingStack what the seat has left behind
 * @returns {number} chips moving into the pot, never negative
 */
export function commitIncrement(amount, alreadyCommitted, remainingStack) {
  const wanted = Math.max(0, amount - alreadyCommitted);
  return Math.min(wanted, Math.max(0, remainingStack));
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
 *   winningSeats: number[],
 *   payouts: Array<{seatNumber: number, amount: number}>,
 *   netBySeat: number[]
 * }}
 */
export function computeHandDerived(hand) {
  const { seats, buttonSeat, format, streets } = hand;
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
        // Clamped like every other commitment: a stack too short to cover the
        // blind posts what it has and is all in, which is a real spot in any
        // tournament and used to produce a negative stack here.
        const seat = bet.seatNumber;
        const increment = commitIncrement(
          committedThisStreet[seat] + bet.amount,
          committedThisStreet[seat],
          seats[seat].stack - contributionsBySeat[seat]
        );
        committedThisStreet[seat] += increment;
        contributionsBySeat[seat] += increment;
        runningPot += increment;
      }
    }

    for (const action of streets[street].actions) {
      if (!ACTION_TYPES_WITH_AMOUNT.includes(action.type)) continue;

      const seat = action.seatNumber;
      const increment = commitIncrement(
        action.amount,
        committedThisStreet[seat],
        seats[seat].stack - contributionsBySeat[seat]
      );
      committedThisStreet[seat] += increment;
      contributionsBySeat[seat] += increment;
      runningPot += increment;
    }

    contributedByStreet[street] = committedThisStreet;
    potAfterStreet[street] = runningPot;
  }

  const totalPot = runningPot;
  const stackAfterBySeat = seats.map((seat, index) => seat.stack - contributionsBySeat[index]);
  const winningSeats = determineWinners(hand);
  const payouts = splitPot(totalPot, winningSeats);

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
    winningSeats,
    payouts,
    netBySeat
  };
}

/**
 * The betting picture partway through a street: who has what out, who is
 * still in, what it costs to call, and what everyone has left.
 *
 * This is what makes the hand editor able to *offer* an action instead of
 * asking the user to work one out. Logging "call" should not require adding up
 * the raise that's already on the table, and a bet slider needs to know the
 * seat's remaining stack to know where its maximum is.
 *
 * It walks the same action list `computeHandDerived` does, through the same
 * `commitIncrement`, which is what keeps the amount the editor suggests equal
 * to the amount the saved hand will report.
 *
 * @param {object} hand a hand record, possibly still being edited
 * @param {string} street which street to stop on
 * @param {number} [actionCount] apply only this many of that street's actions
 *   (defaults to all of them) -- an editor previewing "what would this seat
 *   face" passes the count it has so far
 * @returns {{
 *   committed: number[], contributed: number[], stacks: number[],
 *   folded: boolean[], allIn: boolean[], highestBet: number, pot: number
 * }} `committed` is per seat on this street; `contributed` is across the hand
 */
export function streetBettingState(hand, street, actionCount = Infinity) {
  const { seats, buttonSeat, format, streets } = hand;
  const seatCount = seats.length;

  const contributed = new Array(seatCount).fill(0);
  const folded = new Array(seatCount).fill(false);
  let committed = new Array(seatCount).fill(0);
  let pot = 0;

  for (const name of STREET_NAMES) {
    // Each street starts with a clean slate in front of the seats; only
    // preflop opens with money already out.
    committed = new Array(seatCount).fill(0);

    if (name === 'preflop') {
      for (const bet of deriveForcedBets({ seats, buttonSeat, format })) {
        const increment = commitIncrement(
          committed[bet.seatNumber] + bet.amount,
          committed[bet.seatNumber],
          seats[bet.seatNumber].stack - contributed[bet.seatNumber]
        );
        committed[bet.seatNumber] += increment;
        contributed[bet.seatNumber] += increment;
        pot += increment;
      }
    }

    const actions = name === street
      ? streets[name].actions.slice(0, Math.max(0, actionCount))
      : streets[name].actions;

    for (const action of actions) {
      const seat = action.seatNumber;
      if (action.type === 'fold') {
        folded[seat] = true;
        continue;
      }
      if (!ACTION_TYPES_WITH_AMOUNT.includes(action.type)) continue;

      const increment = commitIncrement(action.amount, committed[seat], seats[seat].stack - contributed[seat]);
      committed[seat] += increment;
      contributed[seat] += increment;
      pot += increment;
    }

    if (name === street) break;
  }

  const stacks = seats.map((seat, index) => seat.stack - contributed[index]);

  return {
    committed,
    contributed,
    stacks,
    folded,
    allIn: stacks.map((stack, index) => stack <= 0 && contributed[index] > 0),
    highestBet: Math.max(0, ...committed),
    pot
  };
}

/**
 * The seat the editor should offer next: the first one after the last actor
 * that is still in the hand and still has chips.
 *
 * A default, not a rule -- the seat picker stays free, because a hand
 * reconstructed from memory is often logged with only the actions that
 * mattered, and insisting on turn order would make that impossible to type.
 *
 * @param {object} hand
 * @param {string} street
 * @param {number} [actionCount] how many of the street's actions have been
 *   logged so far
 * @returns {number|null} null when nobody can act (everyone is folded or all in)
 */
export function nextToAct(hand, street, actionCount = Infinity) {
  const { seats, buttonSeat, streets } = hand;
  const order = actingOrder(seats.length, buttonSeat, street);
  const state = streetBettingState(hand, street, actionCount);

  const applied = streets[street].actions.slice(0, Math.max(0, actionCount));
  const lastActor = applied.length > 0 ? applied.at(-1).seatNumber : null;
  const startAt = lastActor === null ? 0 : (order.indexOf(lastActor) + 1) % order.length;

  for (let step = 0; step < order.length; step += 1) {
    const seat = order[(startAt + step) % order.length];
    if (!state.folded[seat] && !state.allIn[seat]) return seat;
  }
  return null;
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
