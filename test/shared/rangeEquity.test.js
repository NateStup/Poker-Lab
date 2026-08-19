/**
 * Range-equity engine tests.
 *
 * Same philosophy as `equity.test.js`: prefer spots whose outcome is provable
 * by hand over published percentages. Locking every combo to a single
 * possibility (via `dead` cards) and dealing a complete board removes all
 * randomness from a test, so pinned-down scenarios assert on an exact number
 * even though the engine itself is always sampling.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateRangeEquity, DEFAULT_RANGE_ITERATIONS } from '../../src/shared/poker/rangeEquity.js';

describe('calculateRangeEquity correctness', () => {
  it('resolves to a single deterministic combo when only one remains on each side', () => {
    // Blocking Ac and Ad leaves exactly one AA combo: As/Ah (see ranges.test.js).
    // With a complete board and a single villain hand, every sample is identical.
    const result = calculateRangeEquity({
      heroRange: ['AA'],
      villain: { cards: ['Kd', 'Kc'] },
      dead: ['Ac', 'Ad'],
      board: ['2s', '7h', '9c', 'Ts', '3d'],
      iterations: 150,
      seed: 'locked'
    });

    assert.equal(result.hero.comboCount, 1);
    assert.equal(result.villain.comboCount, 1);
    assert.equal(result.iterations, 150);
    // Top pair of aces beats top pair of kings on a completely blank board.
    assert.equal(result.hero.equity, 1);
    assert.equal(result.hero.win, 1);
    assert.equal(result.villain.equity, 0);
  });

  it('splits every runout when the board itself is the best hand for both ranges', () => {
    // A royal flush on the board plays for everyone; hole cards cannot improve
    // on it, so no matter which combo is sampled from either range, it's a tie.
    const result = calculateRangeEquity({
      heroRange: ['22'],
      villain: { hands: ['33'] },
      board: ['Ah', 'Kh', 'Qh', 'Jh', 'Th'],
      iterations: 200,
      seed: 'royal-flush-board'
    });

    assert.equal(result.hero.comboCount, 6);
    assert.equal(result.villain.comboCount, 6);
    assert.equal(result.iterations, 200);
    assert.equal(result.hero.equity, 0.5);
    assert.equal(result.villain.equity, 0.5);
    assert.equal(result.hero.tie, 1);
    assert.equal(result.hero.win, 0);
  });

  it('keeps hero and villain equity summing to 1', () => {
    const result = calculateRangeEquity({
      heroRange: ['AKs', 'AKo', 'QQ'],
      villain: { hands: ['77', '88', '99'] },
      iterations: 3000,
      seed: 'sum-check'
    });

    assert.ok(Math.abs(result.hero.equity + result.villain.equity - 1) < 1e-9);
  });

  it('puts pocket aces well ahead of a specific weak hand preflop', () => {
    const result = calculateRangeEquity({
      heroRange: ['AA'],
      villain: { cards: ['7c', '2d'] },
      iterations: 20000,
      seed: 'aces-vs-72'
    });

    // Published figure is ~87%; band is wide enough to only catch a real regression.
    assert.ok(
      result.hero.equity > 0.8 && result.hero.equity < 0.95,
      `AA had ${result.hero.equity} equity vs 72o`
    );
  });

  it('always reports the sampled method, even for a fully specified board', () => {
    const result = calculateRangeEquity({
      heroRange: ['AA'],
      villain: { cards: ['Kd', 'Kc'] },
      board: ['2s', '7h', '9c', 'Ts', '3d'],
      dead: ['Ac', 'Ad'],
      iterations: 10
    });

    assert.equal(result.method, 'sampled');
  });
});

describe('calculateRangeEquity reproducibility', () => {
  it('returns identical results for an identical seed', () => {
    const spot = { heroRange: ['AKs', 'QQ'], villain: { hands: ['JJ', 'TT'] }, iterations: 4000, seed: 'repeatable' };
    const first = calculateRangeEquity(spot);
    const second = calculateRangeEquity(spot);

    assert.equal(first.hero.equity, second.hero.equity);
    assert.equal(first.seed, second.seed);
  });

  it('returns different samples for different seeds', () => {
    const base = { heroRange: ['AKs', 'QQ'], villain: { hands: ['JJ', 'TT'] }, iterations: 4000 };
    const first = calculateRangeEquity({ ...base, seed: 'a' });
    const second = calculateRangeEquity({ ...base, seed: 'b' });

    assert.notEqual(first.hero.equity, second.hero.equity);
  });
});

describe('calculateRangeEquity input handling', () => {
  it('requires a non-empty hero range', () => {
    assert.throws(() => calculateRangeEquity({ heroRange: [], villain: { cards: ['Ah', 'Ad'] } }), TypeError);
    assert.throws(() => calculateRangeEquity({ villain: { cards: ['Ah', 'Ad'] } }), TypeError);
  });

  it('requires a villain hand or range', () => {
    assert.throws(() => calculateRangeEquity({ heroRange: ['AA'] }), TypeError);
  });

  it('rejects an oversized board', () => {
    assert.throws(
      () => calculateRangeEquity({
        heroRange: ['AA'],
        villain: { cards: ['Kd', 'Kc'] },
        board: ['2c', '7d', '9h', 'Ts', '3s', '4s']
      }),
      TypeError
    );
  });

  it('throws when blocked cards eliminate every hero combo', () => {
    assert.throws(
      () => calculateRangeEquity({
        heroRange: ['AA'],
        villain: { cards: ['Kd', 'Kc'] },
        dead: ['As', 'Ah', 'Ad', 'Ac']
      }),
      RangeError
    );
  });

  it('falls back to the default sample size when none is given', () => {
    const result = calculateRangeEquity({ heroRange: ['AA'], villain: { cards: ['Kd', 'Kc'] } });
    assert.equal(result.iterations, DEFAULT_RANGE_ITERATIONS);
  });
});
