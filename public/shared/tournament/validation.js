/**
 * Validation for tournament requests.
 *
 * Same philosophy as `shared/poker/validation.js`: collect every problem in
 * one pass and hand back a normalised value, rather than throwing on the
 * first bad field.
 */

import { generateBlindStructure } from './blindStructure.js';
import { suggestPayoutSplit } from './payouts.js';

const NAME_MAX_LENGTH = 80;

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
 * @returns {number|null}
 */
function positiveNumber(value, label, errors) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${label} must be a positive number.`);
    return null;
  }
  return parsed;
}

/**
 * @param {unknown} structure
 * @param {string[]} errors collected in place
 * @returns {object[]|null}
 */
function normalizeStructure(structure, errors) {
  if (structure === undefined) return generateBlindStructure();

  if (!Array.isArray(structure) || structure.length === 0) {
    errors.push('`structure` must be a non-empty array of blind levels.');
    return null;
  }

  const normalized = [];
  for (const [index, level] of structure.entries()) {
    const smallBlind = Number(level?.smallBlind);
    const bigBlind = Number(level?.bigBlind);
    const ante = Number(level?.ante ?? 0);
    const durationMinutes = Number(level?.durationMinutes);

    if (!Number.isFinite(smallBlind) || smallBlind <= 0) {
      errors.push(`Level ${index + 1}: smallBlind must be a positive number.`);
      continue;
    }
    if (!Number.isFinite(bigBlind) || bigBlind <= 0) {
      errors.push(`Level ${index + 1}: bigBlind must be a positive number.`);
      continue;
    }
    if (!Number.isFinite(ante) || ante < 0) {
      errors.push(`Level ${index + 1}: ante must be zero or a positive number.`);
      continue;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      errors.push(`Level ${index + 1}: durationMinutes must be a positive number.`);
      continue;
    }

    normalized.push({ level: index + 1, smallBlind, bigBlind, ante, durationMinutes });
  }

  return errors.length === 0 ? normalized : null;
}

/**
 * @param {unknown} split
 * @param {string[]} errors collected in place
 * @returns {number[]|null}
 */
function normalizePayoutSplit(split, errors) {
  if (split === undefined) return suggestPayoutSplit(1);

  if (!Array.isArray(split) || split.length === 0) {
    errors.push('`payoutSplit` must be a non-empty array of percentages.');
    return null;
  }

  const percentages = split.map(Number);
  if (percentages.some(percent => !Number.isFinite(percent) || percent <= 0)) {
    errors.push('`payoutSplit` percentages must all be positive numbers.');
    return null;
  }

  const total = percentages.reduce((sum, percent) => sum + percent, 0);
  if (Math.abs(total - 100) > 0.01) {
    errors.push(`\`payoutSplit\` must sum to 100 (received ${total}).`);
    return null;
  }

  return percentages;
}

/**
 * Normalise and validate a tournament creation request.
 * @param {object} payload
 * @returns {ValidationResult}
 */
export function validateCreateTournamentRequest(payload = {}) {
  const errors = [];
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';

  if (!name) {
    errors.push('`name` is required.');
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.push(`\`name\` must be at most ${NAME_MAX_LENGTH} characters.`);
  }

  const startingStack = positiveNumber(payload.startingStack ?? 10000, '`startingStack`', errors);
  const buyIn = positiveNumber(payload.buyIn ?? 20, '`buyIn`', errors);
  const rebuyStack = positiveNumber(payload.rebuyStack ?? payload.startingStack ?? 10000, '`rebuyStack`', errors);
  const rebuyAmount = positiveNumber(payload.rebuyAmount ?? payload.buyIn ?? 20, '`rebuyAmount`', errors);
  const addOnStack = positiveNumber(payload.addOnStack ?? payload.startingStack ?? 10000, '`addOnStack`', errors);
  const addOnAmount = positiveNumber(payload.addOnAmount ?? payload.buyIn ?? 20, '`addOnAmount`', errors);
  const structure = normalizeStructure(payload.structure, errors);
  const payoutSplit = normalizePayoutSplit(payload.payoutSplit, errors);

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: { name, startingStack, buyIn, rebuyStack, rebuyAmount, addOnStack, addOnAmount, structure, payoutSplit }
  };
}

/**
 * Validate a player registration request.
 * @param {object} payload
 * @returns {ValidationResult}
 */
export function validateRegisterPlayerRequest(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';

  if (!name) {
    return { valid: false, errors: ['`name` is required.'], value: null };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { valid: false, errors: [`\`name\` must be at most ${NAME_MAX_LENGTH} characters.`], value: null };
  }

  return { valid: true, errors: [], value: { name } };
}
