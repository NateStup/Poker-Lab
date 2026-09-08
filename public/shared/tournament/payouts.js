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
 * Hand-written percentage splits for the small place counts, where published
 * structures agree closely and a generated curve reads slightly wrong. Above
 * `MAX_TABULATED_PLACES` the split is generated instead -- writing out a
 * 75-place table by hand would be absurd, and nobody agrees on the exact
 * numbers that far down anyway.
 * @type {Readonly<Record<number, number[]>>}
 */
const DEFAULT_SPLITS = Object.freeze({
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [40, 28, 18, 14],
  5: [35, 24, 17, 13, 11],
  6: [30, 22, 16, 13, 10.5, 8.5],
  7: [28, 20, 15, 12, 10, 8, 7],
  8: [26, 19, 14.5, 11.5, 9.5, 8, 6.5, 5],
  9: [25, 18, 13.5, 11, 9, 7.5, 6.5, 5.25, 4.25]
});

/** The largest place count with a hand-written split. */
export const MAX_TABULATED_PLACES = Object.keys(DEFAULT_SPLITS).length;

/**
 * The share of the field that cashes once the field outgrows the breakpoint
 * table. Live and online tournaments settle on roughly the top 15%, and that
 * convention holds from a few dozen entrants all the way up.
 */
const PAID_FIELD_FRACTION = 0.15;

/**
 * How steeply a generated split falls away from first place.
 *
 * Each place's share is proportional to `1 / place^PAYOUT_DECAY`, normalised
 * to 100. An exponent of 1 (a plain harmonic curve) is a touch too top-heavy
 * against published structures; 0.9 lands close to them -- 15 paid places
 * comes out near 27% for first and 2.3% for the min-cash, which is what real
 * structures of that size actually pay.
 */
const PAYOUT_DECAY = 0.9;

/**
 * Field-size breakpoints for how many places to pay. Each entry is the
 * largest field size that place count still applies to; above the last
 * breakpoint the `PAID_FIELD_FRACTION` formula takes over, and the table's
 * last row is positioned so the two meet without a step.
 *
 * A percentage rule alone is wrong at the small end: "top 15%" doesn't cross
 * the rounding threshold to pay a 2nd place until the field reaches about a
 * dozen entrants, which is a bad default for the home games this app targets,
 * where a sit-and-go should already pay 2nd (and 3rd once the field clears
 * single digits) rather than winner-take-all.
 * @type {ReadonlyArray<[number, number]>}
 */
const PAID_PLACES_BREAKPOINTS = Object.freeze([
  [2, 1],
  [5, 2],
  [9, 3],
  [15, 4],
  [23, 5],
  [39, 6]
]);

/**
 * Suggest how many places to pay for a given field size.
 *
 * @param {number} entryCount
 * @returns {number} at least 1, and never more than the field size
 */
export function suggestPaidPlaces(entryCount) {
  if (entryCount <= 1) return Math.max(1, entryCount);

  for (const [maxEntries, places] of PAID_PLACES_BREAKPOINTS) {
    if (entryCount <= maxEntries) return places;
  }

  return Math.round(entryCount * PAID_FIELD_FRACTION);
}

/**
 * The most places it makes sense to let an organizer pay. You cannot pay more
 * places than you have entrants, and a tournament with nobody registered yet
 * still needs a usable stepper -- hence the floor.
 *
 * @param {number} entryCount
 * @returns {number}
 */
export function maxPaidPlaces(entryCount) {
  return Math.max(MAX_TABULATED_PLACES, entryCount);
}

/**
 * Percentages for a given number of paid places, summing to exactly 100.
 *
 * @param {number} paidPlaces
 * @returns {number[]} percentages summing to 100, one per place
 */
export function suggestPayoutSplit(paidPlaces) {
  const places = Math.max(1, Math.trunc(paidPlaces));
  return DEFAULT_SPLITS[places] || generatePayoutSplit(places);
}

/**
 * Build a payout curve for a place count too large to tabulate by hand.
 *
 * Rounding to two decimals leaves the total a hair off 100, and
 * `calculatePayouts` refuses a split that doesn't total 100 -- so the drift is
 * folded into first place, the same one-place-absorbs-the-remainder rule the
 * payout amounts themselves use.
 *
 * That rounding also flattens the deep tail of a large field into tiers of
 * places paying the same percentage. That is not a defect to smooth out:
 * published structures do exactly the same thing, because the difference
 * between 80th and 81st is not worth expressing.
 *
 * @param {number} paidPlaces
 * @returns {number[]}
 */
function generatePayoutSplit(paidPlaces) {
  const weights = Array.from({ length: paidPlaces }, (_unused, index) => 1 / ((index + 1) ** PAYOUT_DECAY));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const percentages = weights.map(weight => Math.round((weight / totalWeight) * 10000) / 100);
  const drift = 100 - percentages.reduce((sum, percent) => sum + percent, 0);
  percentages[0] = Math.round((percentages[0] + drift) * 100) / 100;

  return percentages;
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
