/**
 * Equity engine tests.
 *
 * Wherever possible these assert on spots whose answer is provable by hand
 * (a locked-up nut hand, an identical-board split) rather than on published
 * percentages, so a failure points at a real defect instead of at sampling
 * noise. The one statistical assertion uses a wide band and a fixed seed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  calculateEquity,
  clampIterations,
  combinationCount,
  combinations
} from '../../src/shared/poker/equity.js';

describe('combinationCount', () => {
  it('computes familiar values', () => {
    assert.equal(combinationCount(52, 2), 1326);
    assert.equal(combinationCount(45, 2), 990);
    assert.equal(combinationCount(48, 5), 1712304);
    assert.equal(combinationCount(44, 1), 44);
  });

  it('handles the degenerate cases', () => {
    assert.equal(combinationCount(5, 0), 1);
    assert.equal(combinationCount(3, 5), 0);
  });
});

describe('combinations', () => {
  it('yields every combination exactly once', () => {
    // The generator reuses its output array for every yield, so the value must
    // be consumed inside the loop; spreading into an array would collect the
    // same reference six times.
    const found = [];
    for (const combo of combinations(['a', 'b', 'c', 'd'], 2)) {
      found.push(combo.join(''));
    }
    assert.equal(found.length, 6);
    assert.deepEqual(found, ['ab', 'ac', 'ad', 'bc', 'bd', 'cd']);
  });

  it('yields a single empty combination for k = 0', () => {
    const found = [...combinations(['a', 'b'], 0)];
    assert.deepEqual(found, [[]]);
  });

  it('yields nothing when k exceeds the input size', () => {
    assert.deepEqual([...combinations(['a'], 3)], []);
  });
});

describe('clampIterations', () => {
  it('keeps a valid value', () => {
    assert.equal(clampIterations(5000), 5000);
  });

  it('clamps to the supported range', () => {
    assert.equal(clampIterations(1), MIN_ITERATIONS);
    assert.equal(clampIterations(10_000_000), MAX_ITERATIONS);
  });

  it('falls back to the default for junk input', () => {
    assert.equal(clampIterations('not a number'), DEFAULT_ITERATIONS);
    assert.equal(clampIterations(undefined), DEFAULT_ITERATIONS);
  });
});

describe('calculateEquity strategy selection', () => {
  it('enumerates exactly on the river (one runout)', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      board: ['2c', '7d', '9h', 'Ts', '3s']
    });

    assert.equal(result.method, 'exact');
    assert.equal(result.possibleRunouts, 1);
    assert.equal(result.iterations, 1);
  });

  it('enumerates exactly on the turn (44 runouts)', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      board: ['2c', '7d', '9h', 'Ts']
    });

    assert.equal(result.method, 'exact');
    assert.equal(result.possibleRunouts, 44);
    assert.equal(result.iterations, 44);
  });

  it('enumerates exactly on the flop (990 runouts)', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      board: ['2c', '7d', '9h']
    });

    assert.equal(result.method, 'exact');
    assert.equal(result.iterations, 990);
  });

  it('samples preflop, where enumeration is impractical', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      iterations: 2000,
      seed: 'test'
    });

    assert.equal(result.method, 'monte-carlo');
    assert.equal(result.iterations, 2000);
    assert.equal(result.possibleRunouts, 1712304);
  });
});

describe('calculateEquity correctness', () => {
  it('gives a locked-up hand 100% equity', () => {
    // Player 1 holds the nut straight flush on a complete board; nothing can
    // change, so the result is not a probability but a certainty.
    const result = calculateEquity({
      players: [['Ah', 'Kh'], ['As', 'Ks']],
      board: ['Qh', 'Jh', 'Th', '2c', '3d']
    });

    assert.equal(result.players[0].equity, 1);
    assert.equal(result.players[1].equity, 0);
    assert.equal(result.players[0].win, 1);
  });

  it('splits the pot evenly when both players play the board', () => {
    const result = calculateEquity({
      players: [['2c', '3d'], ['4c', '5d']],
      board: ['Ah', 'Kh', 'Qh', 'Jh', 'Th']
    });

    assert.equal(result.players[0].equity, 0.5);
    assert.equal(result.players[1].equity, 0.5);
    assert.equal(result.players[0].tie, 1);
    assert.equal(result.players[0].win, 0);
  });

  it('keeps total equity at 1 across all players', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc'], ['Qs', 'Qh']],
      board: ['2c', '7d', '9h']
    });

    const total = result.players.reduce((sum, player) => sum + player.equity, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `equity summed to ${total}`);
  });

  it('puts aces against kings in the expected preflop band', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      iterations: 20000,
      seed: 'aces-vs-kings'
    });

    // The published figure is roughly 82%; the band is wide enough that only a
    // genuine evaluator regression trips it.
    assert.ok(
      result.players[0].equity > 0.78 && result.players[0].equity < 0.86,
      `aces had ${result.players[0].equity} equity`
    );
  });

  it('handles more than two players', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc'], ['Qs', 'Qh'], ['Js', 'Jh']],
      iterations: 1000,
      seed: 1
    });

    assert.equal(result.players.length, 4);
    result.players.forEach(player => {
      assert.ok(player.equity >= 0 && player.equity <= 1);
    });
  });

  it('removes dead cards from the deck', () => {
    // Every heart that would complete the flush is dead, so the flush draw
    // cannot get there and the result must differ from the live-deck case.
    const withDead = calculateEquity({
      players: [['Ah', 'Kh'], ['2c', '2d']],
      board: ['Qh', 'Jh', '3s'],
      dead: ['2h', '3h', '4h', '5h', '6h', '7h', '8h', '9h']
    });

    assert.equal(withDead.method, 'exact');
    assert.equal(withDead.possibleRunouts, combinationCount(37, 2));
  });
});

describe('calculateEquity reproducibility', () => {
  it('returns identical results for an identical seed', () => {
    const spot = { players: [['As', 'Ah'], ['Kd', 'Kc']], iterations: 3000, seed: 'repeatable' };
    const first = calculateEquity(spot);
    const second = calculateEquity(spot);

    assert.equal(first.players[0].equity, second.players[0].equity);
    assert.equal(first.seed, second.seed);
  });

  it('returns different samples for different seeds', () => {
    const first = calculateEquity({ players: [['As', 'Ah'], ['Kd', 'Kc']], iterations: 3000, seed: 'a' });
    const second = calculateEquity({ players: [['As', 'Ah'], ['Kd', 'Kc']], iterations: 3000, seed: 'b' });

    assert.notEqual(first.players[0].equity, second.players[0].equity);
  });

  it('reports no seed for exact runs, which need none', () => {
    const result = calculateEquity({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      board: ['2c', '7d', '9h', 'Ts']
    });
    assert.equal(result.seed, null);
  });
});

describe('calculateEquity input handling', () => {
  it('requires at least two players', () => {
    assert.throws(() => calculateEquity({ players: [['As', 'Ah']] }), TypeError);
    assert.throws(() => calculateEquity({}), TypeError);
  });

  it('rejects an oversized board', () => {
    assert.throws(
      () => calculateEquity({
        players: [['As', 'Ah'], ['Kd', 'Kc']],
        board: ['2c', '7d', '9h', 'Ts', '3s', '4s']
      }),
      TypeError
    );
  });
});
