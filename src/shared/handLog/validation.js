/**
 * Validation for hand-log requests.
 *
 * Same philosophy as the other validators here: collect every problem in one
 * pass and hand back a fully normalised record, so the store never holds a
 * half-specified hand and `computeHandDerived` can index seats and streets
 * without defensive checks.
 *
 * What it does *not* check is poker legality -- see `actions.js`. A hand
 * where someone bets after folding is a strange log, not a rejected one.
 */

import { HOLE_CARD_COUNT, findDuplicateCards, normalizeCard } from '../poker/cards.js';
import { ACTION_TYPES, ACTION_TYPES_WITH_AMOUNT, STREET_BOARD_SIZE, STREET_NAMES } from './actions.js';
import { MAX_PLAYERS, MIN_PLAYERS } from './positions.js';

const NAME_MAX_LENGTH = 120;
const NOTES_MAX_LENGTH = 2000;
const SEAT_NAME_MAX_LENGTH = 40;
const GAME_TYPES = Object.freeze(['cash', 'tournament']);

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 * @property {object|null} value
 */

/**
 * @param {unknown} value
 * @param {string} label
 * @param {string[]} errors collected in place
 * @returns {number} 0 when invalid (the error is already recorded)
 */
function nonNegativeNumber(value, label, errors) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${label} must be zero or a positive number.`);
    return 0;
  }
  return parsed;
}

/**
 * @param {unknown} text
 * @param {number} maxLength
 * @param {string} label
 * @param {string[]} errors collected in place
 * @returns {string}
 */
function normalizeNotes(text, maxLength, label, errors) {
  if (text === undefined || text === null) return '';
  if (typeof text !== 'string') {
    errors.push(`${label} must be a string.`);
    return '';
  }
  if (text.length > maxLength) {
    errors.push(`${label} must be at most ${maxLength} characters.`);
    return '';
  }
  return text;
}

/**
 * Hole cards are a fixed-size pair with `null` holes, never a short array --
 * that's what lets a seat be half-filled in the UI (one card known, one not)
 * and still round-trip through storage unchanged.
 * @param {unknown} cards
 * @param {string} label
 * @param {string[]} errors collected in place
 * @returns {Array<string|null>}
 */
function normalizeHoleCards(cards, label, errors) {
  if (cards === undefined || cards === null) return new Array(HOLE_CARD_COUNT).fill(null);

  if (!Array.isArray(cards) || cards.length !== HOLE_CARD_COUNT) {
    errors.push(`${label} must be an array of exactly ${HOLE_CARD_COUNT} entries (use null for an unknown card).`);
    return new Array(HOLE_CARD_COUNT).fill(null);
  }

  return cards.map(card => {
    if (card === null || card === undefined || card === '') return null;
    const normalized = normalizeCard(card);
    if (!normalized) {
      errors.push(`${label} has an invalid card: ${JSON.stringify(card)}.`);
      return null;
    }
    return normalized;
  });
}

/**
 * @param {unknown} format
 * @param {number} seatCount
 * @param {string[]} errors collected in place
 * @returns {object}
 */
function normalizeFormat(format, seatCount, errors) {
  const source = format && typeof format === 'object' ? format : {};

  const gameType = GAME_TYPES.includes(source.gameType) ? source.gameType : 'cash';
  if (source.gameType !== undefined && !GAME_TYPES.includes(source.gameType)) {
    errors.push(`\`format.gameType\` must be one of ${GAME_TYPES.join(', ')}.`);
  }

  const smallBlind = nonNegativeNumber(source.smallBlind, '`format.smallBlind`', errors);
  const bigBlind = nonNegativeNumber(source.bigBlind, '`format.bigBlind`', errors);
  const ante = nonNegativeNumber(source.ante, '`format.ante`', errors);

  let straddleSeat = null;
  let straddleAmount = 0;
  if (source.straddleSeat !== null && source.straddleSeat !== undefined && source.straddleSeat !== '') {
    const seat = Number(source.straddleSeat);
    if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount) {
      errors.push(`\`format.straddleSeat\` must be a seat number between 0 and ${seatCount - 1}, or null.`);
    } else {
      straddleSeat = seat;
      straddleAmount = nonNegativeNumber(source.straddleAmount, '`format.straddleAmount`', errors);
      if (straddleAmount === 0) {
        errors.push('`format.straddleAmount` must be greater than zero when a straddle seat is set.');
      }
    }
  }

  return { gameType, smallBlind, bigBlind, ante, straddleSeat, straddleAmount };
}

/**
 * @param {unknown} seats
 * @param {string[]} errors collected in place
 * @returns {object[]|null}
 */
function normalizeSeats(seats, errors) {
  if (!Array.isArray(seats)) {
    errors.push('`seats` must be an array.');
    return null;
  }
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    errors.push(`A hand must have between ${MIN_PLAYERS} and ${MAX_PLAYERS} seats (received ${seats.length}).`);
    return null;
  }

  const normalized = seats.map((seat, index) => {
    const source = seat && typeof seat === 'object' ? seat : {};
    const name = typeof source.name === 'string' ? source.name.trim().slice(0, SEAT_NAME_MAX_LENGTH) : '';

    return {
      seatNumber: index,
      name: name || `Seat ${index + 1}`,
      stack: nonNegativeNumber(source.stack, `Seat ${index + 1} stack`, errors),
      isHero: source.isHero === true,
      cards: normalizeHoleCards(source.cards, `Seat ${index + 1} cards`, errors)
    };
  });

  const heroCount = normalized.filter(seat => seat.isHero).length;
  if (heroCount !== 1) {
    errors.push(`Exactly one seat must be marked as the hero (received ${heroCount}).`);
  }

  return normalized;
}

/**
 * @param {unknown} actions
 * @param {number} seatCount
 * @param {string} street
 * @param {string[]} errors collected in place
 * @returns {object[]}
 */
function normalizeActions(actions, seatCount, street, errors) {
  if (actions === undefined || actions === null) return [];
  if (!Array.isArray(actions)) {
    errors.push(`\`streets.${street}.actions\` must be an array.`);
    return [];
  }

  const normalized = [];
  actions.forEach((action, index) => {
    const label = `\`streets.${street}.actions[${index}]\``;
    const source = action && typeof action === 'object' ? action : {};

    const seatNumber = Number(source.seatNumber);
    if (!Number.isInteger(seatNumber) || seatNumber < 0 || seatNumber >= seatCount) {
      errors.push(`${label} has an unknown seat: ${JSON.stringify(source.seatNumber)}.`);
      return;
    }
    if (!ACTION_TYPES.includes(source.type)) {
      errors.push(`${label} must have a type of ${ACTION_TYPES.join(', ')}.`);
      return;
    }

    const carriesAmount = ACTION_TYPES_WITH_AMOUNT.includes(source.type);
    if (!carriesAmount) {
      normalized.push({ seatNumber, type: source.type, amount: 0 });
      return;
    }

    const amount = Number(source.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`${label} is a ${source.type} and needs a positive amount.`);
      return;
    }
    normalized.push({ seatNumber, type: source.type, amount });
  });

  return normalized;
}

/**
 * Board cards for one street. A street is either fully dealt or not dealt at
 * all -- there is no such thing as a two-card flop -- which is the per-street
 * form of the same rule `validateEquityRequest` applies to a whole board.
 * @param {unknown} board
 * @param {string} street
 * @param {string[]} errors collected in place
 * @returns {string[]}
 */
function normalizeStreetBoard(board, street, errors) {
  const expected = STREET_BOARD_SIZE[street];
  if (board === undefined || board === null) return [];

  if (!Array.isArray(board)) {
    errors.push(`\`streets.${street}.board\` must be an array.`);
    return [];
  }

  const present = board.filter(card => card !== null && card !== undefined && card !== '');
  if (present.length === 0) return [];

  if (present.length !== expected) {
    errors.push(`The ${street} is either fully dealt (${expected} card${expected === 1 ? '' : 's'}) or not dealt at all (received ${present.length}).`);
    return [];
  }

  const normalized = present.map(normalizeCard);
  const invalidIndex = normalized.findIndex(card => card === null);
  if (invalidIndex !== -1) {
    errors.push(`\`streets.${street}.board\` has an invalid card: ${JSON.stringify(present[invalidIndex])}.`);
    return [];
  }

  return normalized;
}

/**
 * @param {unknown} streets
 * @param {number} seatCount
 * @param {string[]} errors collected in place
 * @returns {object}
 */
function normalizeStreets(streets, seatCount, errors) {
  const source = streets && typeof streets === 'object' ? streets : {};
  const normalized = {};

  for (const street of STREET_NAMES) {
    const streetSource = source[street] && typeof source[street] === 'object' ? source[street] : {};
    normalized[street] = {
      board: normalizeStreetBoard(streetSource.board, street, errors),
      actions: normalizeActions(streetSource.actions, seatCount, street, errors),
      notes: normalizeNotes(streetSource.notes, NOTES_MAX_LENGTH, `\`streets.${street}.notes\``, errors)
    };
  }

  // Streets are dealt in order, so a turn card with no flop is a data error
  // rather than an unusual hand -- unlike the action list, this one really
  // is impossible.
  const dealt = STREET_NAMES.filter(street => normalized[street].board.length > 0);
  for (const street of dealt) {
    const index = STREET_NAMES.indexOf(street);
    const previous = STREET_NAMES[index - 1];
    if (index > 1 && normalized[previous].board.length === 0) {
      errors.push(`The ${street} cannot be dealt before the ${previous}.`);
    }
  }

  return normalized;
}

/**
 * @param {unknown} result
 * @param {number} seatCount
 * @param {string[]} errors collected in place
 * @returns {object}
 */
function normalizeResult(result, seatCount, errors) {
  const source = result && typeof result === 'object' ? result : {};
  const rawWinners = Array.isArray(source.winningSeats) ? source.winningSeats : [];

  const winningSeats = [];
  for (const raw of rawWinners) {
    const seatNumber = Number(raw);
    if (!Number.isInteger(seatNumber) || seatNumber < 0 || seatNumber >= seatCount) {
      errors.push(`\`result.winningSeats\` has an unknown seat: ${JSON.stringify(raw)}.`);
      continue;
    }
    if (!winningSeats.includes(seatNumber)) winningSeats.push(seatNumber);
  }

  return {
    winningSeats,
    notes: normalizeNotes(source.notes, NOTES_MAX_LENGTH, '`result.notes`', errors)
  };
}

/**
 * Normalise and validate a hand-log payload.
 *
 * @param {object} payload
 * @returns {ValidationResult}
 */
export function validateHandLogRequest(payload = {}) {
  const errors = [];

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    errors.push('`name` is required.');
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.push(`\`name\` must be at most ${NAME_MAX_LENGTH} characters.`);
  }

  const seats = normalizeSeats(payload.seats, errors);
  if (!seats) return { valid: false, errors, value: null };

  const seatCount = seats.length;
  const format = normalizeFormat(payload.format, seatCount, errors);

  const buttonSeat = Number(payload.buttonSeat ?? 0);
  if (!Number.isInteger(buttonSeat) || buttonSeat < 0 || buttonSeat >= seatCount) {
    errors.push(`\`buttonSeat\` must be a seat number between 0 and ${seatCount - 1}.`);
  }

  const streets = normalizeStreets(payload.streets, seatCount, errors);
  const result = normalizeResult(payload.result, seatCount, errors);

  const duplicates = findDuplicateCards(
    ...seats.map(seat => seat.cards.filter(Boolean)),
    ...STREET_NAMES.map(street => streets[street].board)
  );
  if (duplicates.length > 0) {
    errors.push(`Each card may only be used once. Duplicated: ${duplicates.join(', ')}.`);
  }

  if (errors.length > 0) return { valid: false, errors, value: null };

  return {
    valid: true,
    errors: [],
    value: { name, format, seats, buttonSeat, streets, result }
  };
}

/**
 * An empty hand, ready to be filled in. Lives here rather than in the client
 * so a seat's shape is defined once -- the UI builds its initial state from
 * the same definition the validator enforces.
 *
 * @param {object} [options]
 * @param {number} [options.seatCount]
 * @returns {object}
 */
export function createEmptyHand({ seatCount = 6 } = {}) {
  const streets = {};
  for (const street of STREET_NAMES) {
    streets[street] = { board: [], actions: [], notes: '' };
  }

  return {
    name: '',
    format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: null, straddleAmount: 0 },
    seats: Array.from({ length: seatCount }, (_unused, index) => ({
      seatNumber: index,
      name: `Seat ${index + 1}`,
      stack: 200,
      isHero: index === 0,
      cards: new Array(HOLE_CARD_COUNT).fill(null)
    })),
    buttonSeat: 0,
    streets,
    result: { winningSeats: [], notes: '' }
  };
}
