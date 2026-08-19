/**
 * Validation for equity requests.
 *
 * Lives in `shared/` deliberately: the browser runs the same checks to give
 * instant feedback, and the server runs them again because client-side
 * validation is a convenience, never a guarantee.
 *
 * Validators return a result object rather than throwing so callers can report
 * every problem at once instead of surfacing them one refresh at a time.
 */

import { BOARD_SIZE, HOLE_CARD_COUNT, findDuplicateCards, isValidCard, normalizeCard } from './cards.js';
import { MAX_ITERATIONS, MIN_ITERATIONS } from './equity.js';
import { isValidHandCode } from './ranges.js';

/** Boards may only be revealed at street boundaries. */
const LEGAL_BOARD_SIZES = Object.freeze([0, 3, 4, 5]);

/** Guard rails on table size. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors human-readable problems, empty when valid
 * @property {object|null} value the normalised request, or null when invalid
 */

/**
 * Normalise and validate an equity request payload.
 *
 * @param {object} payload raw request body
 * @returns {ValidationResult}
 */
export function validateEquityRequest(payload = {}) {
  const errors = [];
  const { players, board, dead, iterations, seed } = payload;

  const normalizedPlayers = normalizePlayers(players, errors);
  const normalizedBoard = normalizeCardList(board, 'Board', BOARD_SIZE, errors);
  const normalizedDead = normalizeCardList(dead, 'Dead cards', 52, errors);

  if (normalizedBoard && !LEGAL_BOARD_SIZES.includes(normalizedBoard.length)) {
    errors.push(`Board must contain 0, 3, 4, or ${BOARD_SIZE} cards (received ${normalizedBoard.length}).`);
  }

  if (normalizedPlayers && normalizedBoard && normalizedDead) {
    const duplicates = findDuplicateCards(...normalizedPlayers, normalizedBoard, normalizedDead);
    if (duplicates.length > 0) {
      errors.push(`Each card may only be used once. Duplicated: ${duplicates.join(', ')}.`);
    }
  }

  const normalizedIterations = normalizeIterations(iterations, errors);

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: {
      players: normalizedPlayers,
      board: normalizedBoard,
      dead: normalizedDead,
      iterations: normalizedIterations,
      seed: typeof seed === 'string' || typeof seed === 'number' ? seed : undefined
    }
  };
}

/**
 * @param {unknown} players
 * @param {string[]} errors collected in place
 * @returns {string[][]|null}
 */
function normalizePlayers(players, errors) {
  if (!Array.isArray(players)) {
    errors.push('`players` must be an array of hole-card arrays.');
    return null;
  }

  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    errors.push(`Provide between ${MIN_PLAYERS} and ${MAX_PLAYERS} players (received ${players.length}).`);
    return null;
  }

  const normalized = [];
  let failed = false;

  players.forEach((hand, index) => {
    const label = `Player ${index + 1}`;

    if (!Array.isArray(hand) || hand.length !== HOLE_CARD_COUNT) {
      errors.push(`${label} must have exactly ${HOLE_CARD_COUNT} hole cards.`);
      failed = true;
      return;
    }

    const cards = hand.map(normalizeCard);
    const invalid = hand.filter((_, i) => !cards[i]);
    if (invalid.length > 0) {
      errors.push(`${label} has invalid cards: ${invalid.map(card => JSON.stringify(card)).join(', ')}.`);
      failed = true;
      return;
    }

    normalized.push(cards);
  });

  return failed ? null : normalized;
}

/**
 * @param {unknown} cards
 * @param {string} label used in error messages
 * @param {number} max
 * @param {string[]} errors collected in place
 * @returns {string[]|null}
 */
function normalizeCardList(cards, label, max, errors) {
  if (cards === undefined || cards === null) return [];

  if (!Array.isArray(cards)) {
    errors.push(`${label} must be an array of cards.`);
    return null;
  }

  const present = cards.filter(Boolean);
  if (present.length > max) {
    errors.push(`${label} may contain at most ${max} cards.`);
    return null;
  }

  const normalized = present.map(normalizeCard);
  const invalidIndex = normalized.findIndex(card => card === null);
  if (invalidIndex !== -1) {
    errors.push(`${label} has an invalid card: ${JSON.stringify(present[invalidIndex])}.`);
    return null;
  }

  return normalized;
}

/**
 * @param {unknown} iterations
 * @param {string[]} errors collected in place
 * @returns {number|undefined}
 */
function normalizeIterations(iterations, errors) {
  if (iterations === undefined || iterations === null) return undefined;

  const parsed = Number(iterations);
  if (!Number.isInteger(parsed)) {
    errors.push('`iterations` must be an integer.');
    return undefined;
  }

  if (parsed < MIN_ITERATIONS || parsed > MAX_ITERATIONS) {
    errors.push(`\`iterations\` must be between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}.`);
    return undefined;
  }

  return parsed;
}

/**
 * Normalise and validate a range-equity request payload.
 *
 * @param {object} payload raw request body
 * @returns {ValidationResult}
 */
export function validateRangeEquityRequest(payload = {}) {
  const errors = [];
  const { heroRange, villain, board, dead, iterations, seed } = payload;

  const normalizedHeroRange = normalizeHandList(heroRange, '`heroRange`', errors);
  const normalizedVillain = normalizeVillain(villain, errors);
  const normalizedBoard = normalizeCardList(board, 'Board', BOARD_SIZE, errors);
  const normalizedDead = normalizeCardList(dead, 'Dead cards', 52, errors);

  if (normalizedBoard && !LEGAL_BOARD_SIZES.includes(normalizedBoard.length)) {
    errors.push(`Board must contain 0, 3, 4, or ${BOARD_SIZE} cards (received ${normalizedBoard.length}).`);
  }

  if (normalizedVillain?.cards && normalizedBoard && normalizedDead) {
    const duplicates = findDuplicateCards(normalizedVillain.cards, normalizedBoard, normalizedDead);
    if (duplicates.length > 0) {
      errors.push(`Each card may only be used once. Duplicated: ${duplicates.join(', ')}.`);
    }
  }

  const normalizedIterations = normalizeIterations(iterations, errors);

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: {
      heroRange: normalizedHeroRange,
      villain: normalizedVillain,
      board: normalizedBoard,
      dead: normalizedDead,
      iterations: normalizedIterations,
      seed: typeof seed === 'string' || typeof seed === 'number' ? seed : undefined
    }
  };
}

/**
 * @param {unknown} hands
 * @param {string} label used in error messages
 * @param {string[]} errors collected in place
 * @returns {string[]|null}
 */
function normalizeHandList(hands, label, errors) {
  if (!Array.isArray(hands) || hands.length === 0) {
    errors.push(`${label} must be a non-empty array of hand codes.`);
    return null;
  }

  const invalid = hands.filter(hand => !isValidHandCode(hand));
  if (invalid.length > 0) {
    errors.push(`${label} has invalid hand codes: ${invalid.map(hand => JSON.stringify(hand)).join(', ')}.`);
    return null;
  }

  return hands;
}

/**
 * @param {unknown} villain
 * @param {string[]} errors collected in place
 * @returns {{cards: string[]}|{hands: string[]}|null}
 */
function normalizeVillain(villain, errors) {
  if (!villain || typeof villain !== 'object' || Array.isArray(villain)) {
    errors.push('`villain` must be an object with either `cards` (a specific hand) or `hands` (a range).');
    return null;
  }

  if (Array.isArray(villain.cards)) {
    if (villain.cards.length !== HOLE_CARD_COUNT) {
      errors.push(`\`villain.cards\` must have exactly ${HOLE_CARD_COUNT} cards.`);
      return null;
    }

    const cards = villain.cards.map(normalizeCard);
    const invalid = villain.cards.filter((_, i) => !cards[i]);
    if (invalid.length > 0) {
      errors.push(`\`villain.cards\` has invalid cards: ${invalid.map(card => JSON.stringify(card)).join(', ')}.`);
      return null;
    }

    return { cards };
  }

  if (Array.isArray(villain.hands)) {
    const hands = normalizeHandList(villain.hands, '`villain.hands`', errors);
    return hands ? { hands } : null;
  }

  errors.push('`villain` must provide either `cards` or `hands`.');
  return null;
}

/**
 * Validate a bare list of cards, e.g. from a text input.
 * @param {string[]} cards
 * @returns {ValidationResult}
 */
export function validateCards(cards) {
  const errors = [];

  if (!Array.isArray(cards)) {
    return { valid: false, errors: ['Expected an array of cards.'], value: null };
  }

  const invalid = cards.filter(card => !isValidCard(normalizeCard(card) || ''));
  if (invalid.length > 0) {
    errors.push(`Invalid cards: ${invalid.join(', ')}.`);
  }

  const duplicates = findDuplicateCards(cards.map(normalizeCard).filter(Boolean));
  if (duplicates.length > 0) {
    errors.push(`Duplicate cards: ${duplicates.join(', ')}.`);
  }

  return errors.length > 0
    ? { valid: false, errors, value: null }
    : { valid: true, errors: [], value: cards.map(normalizeCard) };
}
