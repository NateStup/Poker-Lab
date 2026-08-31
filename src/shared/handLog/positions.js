/**
 * Table positions derived from seat count and button location.
 *
 * A logged hand records where the button was, not what each seat was
 * "called" -- position labels are a function of the button, so storing them
 * per seat would be denormalised data that can silently disagree with
 * `buttonSeat` after an edit. `derivePositions` is the single place that
 * mapping lives, and both runtimes call it.
 */

import { MAX_PLAYERS, MIN_PLAYERS } from '../poker/validation.js';

/**
 * Position labels in seating order starting from the button, for each
 * supported table size. Read left-to-right as "button, then the next seat
 * clockwise, then the next...".
 *
 * Heads-up is the special case every position table has to hard-code: the
 * button *is* the small blind and acts first preflop, so a 2-handed table
 * has no separate SB seat. Spelling that out here rather than deriving it
 * keeps the irregularity in one visible place instead of in an `if` inside
 * the rotation logic.
 * @type {Readonly<Record<number, string[]>>}
 */
const POSITION_ORDER_BY_SEAT_COUNT = Object.freeze({
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO'],
  10: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO']
});

export { MAX_PLAYERS, MIN_PLAYERS };

/**
 * Position labels indexed by seat number.
 *
 * @param {number} seatCount how many seats are at the table
 * @param {number} buttonSeat the seat index holding the button
 * @returns {string[]} `result[seatNumber]` is that seat's position label
 * @throws {RangeError} if the seat count isn't a supported table size
 */
export function derivePositions(seatCount, buttonSeat) {
  const order = POSITION_ORDER_BY_SEAT_COUNT[seatCount];
  if (!order) {
    throw new RangeError(`Unsupported table size: ${seatCount} (expected ${MIN_PLAYERS}-${MAX_PLAYERS})`);
  }

  const positions = new Array(seatCount);
  for (let offset = 0; offset < seatCount; offset += 1) {
    positions[(buttonSeat + offset) % seatCount] = order[offset];
  }
  return positions;
}

/**
 * Seats in the order they act on a given street.
 *
 * Postflop the small blind is first and the button is last, which is just
 * "clockwise from the button". Preflop the blinds have already acted, so the
 * first decision belongs to the seat after the big blind -- and heads-up
 * inverts the whole thing, because the button *is* the small blind and so acts
 * first preflop and last after it. That's the same irregularity
 * `POSITION_ORDER_BY_SEAT_COUNT` spells out rather than derives.
 *
 * This drives a *suggestion* -- which seat the hand editor offers next -- not a
 * rule. Nothing rejects an action logged out of turn; see `actions.js`.
 *
 * @param {number} seatCount
 * @param {number} buttonSeat
 * @param {string} street one of `STREET_NAMES`
 * @returns {number[]} seat numbers, first to act first
 */
export function actingOrder(seatCount, buttonSeat, street) {
  const isPreflop = street === 'preflop';
  const headsUp = seatCount === 2;

  // Postflop: the seat after the button leads. Preflop: three seats after it
  // (button, small blind, big blind have all been passed) -- except heads-up,
  // where the button leads preflop and trails afterwards.
  const offset = isPreflop ? (headsUp ? 0 : 3) : 1;

  const order = new Array(seatCount);
  for (let index = 0; index < seatCount; index += 1) {
    order[index] = (buttonSeat + offset + index) % seatCount;
  }
  return order;
}

/**
 * Find the seat holding a given position label.
 *
 * @param {string[]} positions from `derivePositions`
 * @param {string} label e.g. `'BB'`
 * @returns {number} the seat number, or -1 when the table has no such position
 */
export function seatWithPosition(positions, label) {
  return positions.indexOf(label);
}

/**
 * The seat that posts the small blind. Heads-up this is the button itself,
 * which is why it can't just be "the seat after the button".
 *
 * @param {string[]} positions from `derivePositions`
 * @returns {number} the seat number, or -1 if there is no such seat
 */
export function smallBlindSeat(positions) {
  const dedicated = positions.indexOf('SB');
  return dedicated === -1 ? positions.indexOf('BTN/SB') : dedicated;
}

/**
 * The seat that posts the big blind.
 * @param {string[]} positions from `derivePositions`
 * @returns {number} the seat number, or -1 if there is no such seat
 */
export function bigBlindSeat(positions) {
  return positions.indexOf('BB');
}
