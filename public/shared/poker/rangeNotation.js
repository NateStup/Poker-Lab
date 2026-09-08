/**
 * Standard poker range shorthand -- the notation every range tool (PokerStove,
 * Equilab, Flopzilla, GTO charts) reads and writes: `'22+'` (a pair and every
 * pair above it), `'A5s+'` (a suited ace and every stronger suited ace),
 * `'77-TT'` (an inclusive span of pairs). This module is the bridge between
 * that text form and the `Set<string>` of hand codes the range grid works
 * with internally.
 *
 * Pure and isomorphic, like the rest of `shared/`.
 */

import { RANK_VALUES, RANKS } from './cards.js';
import { RANK_ORDER, isValidHandCode, parseHandCode } from './ranges.js';

/**
 * Normalise a raw hand-code substring's case (`'aks'` -> `'AKs'`), without
 * validating that it's a *canonical* code -- {@link parseHandCode} still does
 * that. Mirrors `normalizeCard`'s role in `cards.js` for the same reason:
 * user-typed input shouldn't have to match exact case to be understood.
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeHandToken(raw) {
  if (raw.length === 2) {
    const upper = raw.toUpperCase();
    return RANKS.includes(upper[0]) && upper[0] === upper[1] ? upper : null;
  }
  if (raw.length === 3) {
    const ranks = raw.slice(0, 2).toUpperCase();
    const suffix = raw[2].toLowerCase();
    return suffix === 's' || suffix === 'o' ? ranks + suffix : null;
  }
  return null;
}

/**
 * @param {string} rankHigh
 * @param {string} rankOther
 * @param {'pair'|'suited'|'offsuit'} type
 * @returns {string}
 */
function buildHandCode(rankHigh, rankOther, type) {
  if (type === 'pair') return `${rankHigh}${rankHigh}`;
  return `${rankHigh}${rankOther}${type === 'suited' ? 's' : 'o'}`;
}

/**
 * Expand a `'+'`-suffixed token, e.g. `'77+'` or `'A5s+'`.
 * @param {string} base the token with the trailing `+` already removed
 * @returns {string[]|null} `null` if `base` isn't a canonical hand code
 */
function expandPlus(base) {
  const normalized = normalizeHandToken(base);
  const parsed = normalized && parseHandCode(normalized);
  if (!parsed) return null;
  const { rankHigh, rankLow, type } = parsed;

  if (type === 'pair') {
    // Every pair from this rank up through aces.
    const ceilingIndex = RANK_ORDER.indexOf(rankHigh);
    return RANK_ORDER.slice(0, ceilingIndex + 1).map(rank => `${rank}${rank}`);
  }

  // Fix the top card; walk the second card's rank up towards (but not
  // reaching) the top card -- that's what "a hand and everything stronger"
  // means once the top card is already fixed.
  const highIndex = RANK_ORDER.indexOf(rankHigh);
  const lowIndex = RANK_ORDER.indexOf(rankLow);
  const hands = [];
  for (let i = lowIndex; i > highIndex; i--) {
    hands.push(buildHandCode(rankHigh, RANK_ORDER[i], type));
  }
  return hands;
}

/**
 * Expand a dash-spanned token, e.g. `'77-TT'` or `'A5s-A9s'`.
 * @param {string} leftRaw
 * @param {string} rightRaw
 * @returns {string[]|null} `null` if either side is invalid or they aren't
 *   the same family (same type, and same top card for suited/offsuit)
 */
function expandDash(leftRaw, rightRaw) {
  const leftToken = normalizeHandToken(leftRaw);
  const rightToken = normalizeHandToken(rightRaw);
  const left = leftToken && parseHandCode(leftToken);
  const right = rightToken && parseHandCode(rightToken);
  if (!left || !right || left.type !== right.type) return null;

  if (left.type === 'pair') {
    const a = RANK_ORDER.indexOf(left.rankHigh);
    const b = RANK_ORDER.indexOf(right.rankHigh);
    const [start, end] = a <= b ? [a, b] : [b, a];
    return RANK_ORDER.slice(start, end + 1).map(rank => `${rank}${rank}`);
  }

  if (left.rankHigh !== right.rankHigh) return null;
  const a = RANK_ORDER.indexOf(left.rankLow);
  const b = RANK_ORDER.indexOf(right.rankLow);
  const [start, end] = a <= b ? [a, b] : [b, a];
  return RANK_ORDER.slice(start, end + 1).map(rank => buildHandCode(left.rankHigh, rank, left.type));
}

/**
 * @param {string} token a single comma/whitespace-separated piece of a range string
 * @returns {string[]|null} the hand codes it expands to, or `null` if unrecognised
 */
function expandToken(token) {
  if (token.endsWith('+')) {
    return expandPlus(token.slice(0, -1));
  }

  const dashIndex = token.indexOf('-');
  if (dashIndex > 0) {
    return expandDash(token.slice(0, dashIndex), token.slice(dashIndex + 1));
  }

  const normalized = normalizeHandToken(token);
  return normalized && isValidHandCode(normalized) ? [normalized] : null;
}

/**
 * Parse a range string into hand codes.
 *
 * Every problem is collected rather than thrown, so a mostly-valid paste
 * (a typo in one token) doesn't discard the rest of it.
 *
 * @param {string} text e.g. `'22+, A5s+, K9s+, QTs+, JTs, AJo+, KQo'`
 * @returns {{hands: string[], errors: string[]}}
 */
export function parseRangeString(text) {
  if (typeof text !== 'string') {
    return { hands: [], errors: ['Expected a range string.'] };
  }

  const hands = new Set();
  const errors = [];

  for (const raw of text.split(/[,\s]+/)) {
    const token = raw.trim();
    if (!token) continue;

    const expanded = expandToken(token);
    if (!expanded) {
      errors.push(`Unrecognized range token: ${JSON.stringify(token)}`);
      continue;
    }
    for (const hand of expanded) hands.add(hand);
  }

  return { hands: [...hands], errors };
}

/**
 * Compress a family of hands (all pairs, or one top card's suited/offsuit
 * hands) ordered strongest-to-weakest into the fewest shorthand tokens.
 * @param {string[]} family strongest first
 * @param {Set<string>} selected
 * @returns {string[]}
 */
function compressFamily(family, selected) {
  const tokens = [];
  let i = 0;

  while (i < family.length) {
    if (!selected.has(family[i])) {
      i++;
      continue;
    }

    let j = i;
    while (j + 1 < family.length && selected.has(family[j + 1])) j++;

    if (i === 0 && j > i) {
      // The run reaches the strongest hand in the family: "weakest in the run" + .
      tokens.push(`${family[j]}+`);
    } else if (j > i) {
      // An interior run: write it ascending, weakest to strongest.
      tokens.push(`${family[j]}-${family[i]}`);
    } else {
      tokens.push(family[i]);
    }

    i = j + 1;
  }

  return tokens;
}

/**
 * Format a set of hand codes into standard range shorthand, using `'+'` and
 * dash spans wherever a run of hands compresses cleanly.
 * @param {Iterable<string>} handCodes
 * @returns {string} e.g. `'AA-JJ,AKs,AKo'`
 */
export function formatRangeString(handCodes) {
  const selected = new Set(handCodes);
  const tokens = [];

  tokens.push(...compressFamily(RANK_ORDER.map(rank => `${rank}${rank}`), selected));

  for (const topRank of RANK_ORDER) {
    const weakerRanks = RANK_ORDER.filter(rank => RANK_VALUES[rank] < RANK_VALUES[topRank]);
    tokens.push(...compressFamily(weakerRanks.map(rank => buildHandCode(topRank, rank, 'suited')), selected));
    tokens.push(...compressFamily(weakerRanks.map(rank => buildHandCode(topRank, rank, 'offsuit')), selected));
  }

  return tokens.join(',');
}
