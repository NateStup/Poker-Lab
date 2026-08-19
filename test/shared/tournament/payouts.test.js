/**
 * Payout suggestion and calculation tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_TABULATED_PLACES,
  calculatePayouts,
  maxPaidPlaces,
  suggestPaidPlaces,
  suggestPayoutSplit
} from '../../../src/shared/tournament/payouts.js';

describe('suggestPaidPlaces', () => {
  it('pays only first place in a heads-up or tiny field', () => {
    assert.equal(suggestPaidPlaces(1), 1);
    assert.equal(suggestPaidPlaces(2), 1);
  });

  it('pays multiple places well before a dozen entrants', () => {
    assert.equal(suggestPaidPlaces(4), 2);
    assert.equal(suggestPaidPlaces(8), 3);
  });

  it('keeps paying more places as a real field grows, rather than stalling', () => {
    // The bug this guards: the suggestion used to cap at six places no matter
    // how large the field got, so a 200-runner event paid the same number of
    // places as a 24-runner one.
    assert.equal(suggestPaidPlaces(60), 9);
    assert.equal(suggestPaidPlaces(100), 15);
    assert.equal(suggestPaidPlaces(200), 30);
    assert.equal(suggestPaidPlaces(1000), 150);
  });

  it('pays roughly the top 15% of any field big enough for that to be sane', () => {
    for (const entryCount of [50, 80, 120, 250, 600]) {
      const places = suggestPaidPlaces(entryCount);
      const fraction = places / entryCount;
      assert.ok(fraction > 0.1 && fraction < 0.2, `${entryCount} entrants paid ${places} places (${fraction})`);
    }
  });

  it('never suggests paying more places than there are entrants', () => {
    for (let entryCount = 0; entryCount <= 200; entryCount += 1) {
      assert.ok(suggestPaidPlaces(entryCount) <= Math.max(1, entryCount), `failed at ${entryCount}`);
    }
  });

  it('never shrinks the payout as the field grows', () => {
    let previous = 0;
    for (let entryCount = 1; entryCount <= 2000; entryCount += 1) {
      const places = suggestPaidPlaces(entryCount);
      assert.ok(places >= previous, `${entryCount} entrants paid fewer places than ${entryCount - 1}`);
      previous = places;
    }
  });
});

describe('maxPaidPlaces', () => {
  it('lets a big field pay far more places than the hand-written tables cover', () => {
    assert.equal(maxPaidPlaces(120), 120);
  });

  it('still allows a usable stepper before anyone has registered', () => {
    assert.equal(maxPaidPlaces(0), MAX_TABULATED_PLACES);
  });
});

describe('suggestPayoutSplit', () => {
  it('returns a split that sums to 100 for every place count, tabulated or generated', () => {
    for (let places = 1; places <= 200; places++) {
      const split = suggestPayoutSplit(places);
      assert.equal(split.length, places);
      const total = split.reduce((sum, pct) => sum + pct, 0);
      assert.ok(Math.abs(total - 100) < 0.01, `${places}-place split summed to ${total}`);
    }
  });

  it('weights first place the heaviest', () => {
    const split = suggestPayoutSplit(4);
    assert.ok(split[0] > split[1] && split[1] > split[2] && split[2] > split[3]);
  });

  it('never pays a place more than the one above it, and never pays nothing', () => {
    // Non-increasing rather than strictly decreasing: deep in a large field
    // the curve flattens into tiers of places paying the same amount, which
    // is what published structures do too. What must never happen is a place
    // paying *more* than the one above it, or rounding away to zero.
    for (const places of [7, 9, 15, 30, 75, 300]) {
      const split = suggestPayoutSplit(places);
      for (let i = 1; i < split.length; i += 1) {
        assert.ok(split[i] <= split[i - 1], `${places}-place split: place ${i + 1} pays more than place ${i}`);
      }
      assert.ok(split.at(-1) > 0, `${places}-place split pays the min-cash nothing`);
      assert.ok(split[0] > split[1], `${places}-place split does not pay first place the most`);
    }
  });

  it('produces a realistic curve for a large field', () => {
    // ~100 runners paying 15 -- published structures of that size put first
    // in the mid-to-high twenties and the min-cash a bit above 2%.
    const split = suggestPayoutSplit(15);
    assert.ok(split[0] > 24 && split[0] < 30, `first place got ${split[0]}%`);
    assert.ok(split.at(-1) > 1.5 && split.at(-1) < 3.5, `min-cash got ${split.at(-1)}%`);
  });

  it('hands every generated split to calculatePayouts without it complaining', () => {
    for (const places of [10, 15, 37, 150]) {
      const payouts = calculatePayouts({ prizePool: 12345, split: suggestPayoutSplit(places) });
      assert.equal(payouts.reduce((sum, payout) => sum + payout.amount, 0), 12345);
    }
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
