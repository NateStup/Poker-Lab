/**
 * Payout suggestions and the actual payout calculation.
 *
 * `suggestPaidPlaces`/`suggestPayoutSplit` are defaults the organizer is
 * expected to override -- there is no universally "correct" payout
 * structure, only common conventions (pay roughly the top 12-15% of the
 * field, weight first place heaviest). `calculatePayouts` is the part that
 * actually matters to get right: it must never pay out more or less than the
 * prize pool because of rounding.
 */

/**
 * Default percentage splits by number of paid places. Common home-game/small
 * MTT conventions -- not derived from anything more rigorous than "this is
 * what most payout calculators default to."
 * @type {Readonly<Record<number, number[]>>}
 */
const DEFAULT_SPLITS = Object.freeze({
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [40, 28, 18, 14],
  5: [35, 24, 17, 13, 11],
  6: [30, 22, 16, 13, 10.5, 8.5]
});

const MAX_SUGGESTED_PLACES = Object.keys(DEFAULT_SPLITS).length;

/**
 * Suggest how many places to pay for a given field size -- roughly the top
 * 12.5%, at least one, capped at the largest split this module has a
 * suggestion for.
 * @param {number} entryCount
 * @returns {number}
 */
export function suggestPaidPlaces(entryCount) {
  if (entryCount <= 1) return 1;
  return Math.min(Math.max(1, Math.round(entryCount * 0.125)), MAX_SUGGESTED_PLACES);
}

/**
 * @param {number} paidPlaces
 * @returns {number[]} percentages summing to 100, one per place
 */
export function suggestPayoutSplit(paidPlaces) {
  return DEFAULT_SPLITS[paidPlaces] || DEFAULT_SPLITS[MAX_SUGGESTED_PLACES];
}

/**
 * Turn a prize pool and a percentage split into actual payout amounts.
 *
 * Percentages are rounded to whole currency units independently, which can
 * leave the sum a unit or two off the pool; the entire remainder is folded
 * into first place rather than spread around, so the total always matches
 * the pool exactly and only one place's number is ever adjusted.
 *
 * @param {object} options
 * @param {number} options.prizePool
 * @param {number[]} options.split percentages, must sum to 100
 * @returns {Array<{place: number, percent: number, amount: number}>}
 * @throws {TypeError} if `split` is empty or doesn't sum to 100
 */
export function calculatePayouts({ prizePool, split }) {
  if (!Array.isArray(split) || split.length === 0) {
    throw new TypeError('calculatePayouts requires a non-empty payout split');
  }

  const totalPercent = split.reduce((sum, percent) => sum + percent, 0);
  if (Math.abs(totalPercent - 100) > 0.01) {
    throw new TypeError(`Payout split must total 100% (received ${totalPercent}%)`);
  }

  const rounded = split.map(percent => Math.round((prizePool * percent) / 100));
  const remainder = Math.round(prizePool) - rounded.reduce((sum, amount) => sum + amount, 0);
  rounded[0] += remainder;

  return rounded.map((amount, index) => ({ place: index + 1, percent: split[index], amount }));
}
