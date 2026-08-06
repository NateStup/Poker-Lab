/**
 * Payout suggestion and calculation tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculatePayouts, suggestPaidPlaces, suggestPayoutSplit } from '../../../src/shared/tournament/payouts.js';

describe('suggestPaidPlaces', () => {
  it('pays only first place in a heads-up or tiny field', () => {
    assert.equal(suggestPaidPlaces(1), 1);
    assert.equal(suggestPaidPlaces(2), 1);
  });

  it('pays multiple places well before a dozen entrants', () => {
    assert.equal(suggestPaidPlaces(4), 2);
    assert.equal(suggestPaidPlaces(8), 3);
  });

  it('pays roughly the top fifth to top quarter of a larger field', () => {
    assert.equal(suggestPaidPlaces(24), 6);
    assert.equal(suggestPaidPlaces(48), 6);
  });

  it('caps at the largest split this module defines', () => {
    assert.equal(suggestPaidPlaces(1000), 6);
  });
});

describe('suggestPayoutSplit', () => {
  it('returns a split that sums to 100 for every suggested place count', () => {
    for (let places = 1; places <= 6; places++) {
      const split = suggestPayoutSplit(places);
      assert.equal(split.length, places);
      const total = split.reduce((sum, pct) => sum + pct, 0);
      assert.ok(Math.abs(total - 100) < 1e-9, `${places}-place split summed to ${total}`);
    }
  });

  it('weights first place the heaviest', () => {
    const split = suggestPayoutSplit(4);
    assert.ok(split[0] > split[1] && split[1] > split[2] && split[2] > split[3]);
  });
});

describe('calculatePayouts', () => {
  it('splits a round prize pool exactly', () => {
    const payouts = calculatePayouts({ prizePool: 1000, split: [50, 30, 20] });
    assert.deepEqual(payouts.map(p => p.amount), [500, 300, 200]);
    assert.equal(payouts.reduce((sum, p) => sum + p.amount, 0), 1000);
  });

  it('folds rounding remainder into first place so the total matches exactly', () => {
    const payouts = calculatePayouts({ prizePool: 100, split: [1 / 3 * 100, 1 / 3 * 100, 1 / 3 * 100] });
    const total = payouts.reduce((sum, p) => sum + p.amount, 0);
    assert.equal(total, 100);
  });

  it('reports place and percent alongside the amount', () => {
    const [first] = calculatePayouts({ prizePool: 200, split: [100] });
    assert.deepEqual(first, { place: 1, percent: 100, amount: 200 });
  });

  it('rejects an empty split', () => {
    assert.throws(() => calculatePayouts({ prizePool: 100, split: [] }), TypeError);
  });

  it('rejects a split that does not sum to 100', () => {
    assert.throws(() => calculatePayouts({ prizePool: 100, split: [50, 40] }), TypeError);
  });
});
