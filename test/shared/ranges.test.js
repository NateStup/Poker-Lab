/**
 * Range grid and combo-expansion tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_HANDS,
  RANGE_GRID,
  TOTAL_COMBOS,
  comboCount,
  expandRangeToCombos,
  handCombos,
  isValidHandCode,
  parseHandCode,
  rangeComboCount
} from '../../src/shared/poker/ranges.js';

describe('RANGE_GRID and ALL_HANDS', () => {
  it('has 169 unique hand codes', () => {
    assert.equal(ALL_HANDS.length, 169);
    assert.equal(new Set(ALL_HANDS).size, 169);
  });

  it('places pairs on the diagonal', () => {
    for (let i = 0; i < RANGE_GRID.length; i++) {
      assert.equal(RANGE_GRID[i][i].type, 'pair');
    }
    assert.equal(RANGE_GRID[0][0].hand, 'AA');
    assert.equal(RANGE_GRID[12][12].hand, '22');
  });

  it('places suited hands above the diagonal and offsuit below it', () => {
    // Row 0 is Ace, column 1 is King: above the diagonal is suited.
    assert.deepEqual(RANGE_GRID[0][1], { hand: 'AKs', type: 'suited' });
    // Mirrored below the diagonal is the offsuit version of the same hand.
    assert.deepEqual(RANGE_GRID[1][0], { hand: 'AKo', type: 'offsuit' });
  });

  it('sums combo counts (78 pairs*6 + 78 suited*4 + 78 offsuit*12) to 1326', () => {
    const total = rangeComboCount(ALL_HANDS);
    assert.equal(total, TOTAL_COMBOS);
    assert.equal(total, 13 * 6 + 78 * 4 + 78 * 12);
  });
});

describe('parseHandCode', () => {
  it('accepts canonical codes', () => {
    assert.deepEqual(parseHandCode('AA'), { rankHigh: 'A', rankLow: 'A', type: 'pair' });
    assert.deepEqual(parseHandCode('AKs'), { rankHigh: 'A', rankLow: 'K', type: 'suited' });
    assert.deepEqual(parseHandCode('AKo'), { rankHigh: 'A', rankLow: 'K', type: 'offsuit' });
  });

  it('rejects a non-canonical rank order', () => {
    assert.equal(parseHandCode('KAs'), null);
  });

  it('rejects unknown ranks, suffixes, and shapes', () => {
    assert.equal(parseHandCode('ZAs'), null);
    assert.equal(parseHandCode('AKx'), null);
    assert.equal(parseHandCode('AKQs'), null);
    assert.equal(parseHandCode(''), null);
    assert.equal(parseHandCode(42), null);
  });
});

describe('isValidHandCode', () => {
  it('only accepts one of the 169 canonical codes', () => {
    assert.equal(isValidHandCode('AA'), true);
    assert.equal(isValidHandCode('AKs'), true);
    assert.equal(isValidHandCode('KAs'), false);
    assert.equal(isValidHandCode('AA '), false);
  });
});

describe('comboCount', () => {
  it('reports 6 for a pair, 4 for suited, 12 for offsuit', () => {
    assert.equal(comboCount('AA'), 6);
    assert.equal(comboCount('AKs'), 4);
    assert.equal(comboCount('AKo'), 12);
  });

  it('reports 0 for an invalid code', () => {
    assert.equal(comboCount('not-a-hand'), 0);
  });
});

describe('handCombos', () => {
  it('expands a pair into every two-suit pairing of that rank', () => {
    const combos = handCombos('AA');
    assert.equal(combos.length, 6);
    for (const [a, b] of combos) {
      assert.equal(a[0], 'A');
      assert.equal(b[0], 'A');
      assert.notEqual(a[1], b[1]);
    }
  });

  it('expands a suited hand into one combo per suit', () => {
    const combos = handCombos('AKs');
    assert.equal(combos.length, 4);
    for (const [a, b] of combos) {
      assert.equal(a[1], b[1]);
    }
  });

  it('expands an offsuit hand into every mismatched suit pairing', () => {
    const combos = handCombos('AKo');
    assert.equal(combos.length, 12);
    for (const [a, b] of combos) {
      assert.notEqual(a[1], b[1]);
    }
  });

  it('throws for a non-canonical code', () => {
    assert.throws(() => handCombos('KAs'), TypeError);
  });
});

describe('expandRangeToCombos', () => {
  it('deduplicates repeated hand codes', () => {
    const once = expandRangeToCombos(['AA']);
    const twice = expandRangeToCombos(['AA', 'AA']);
    assert.equal(once.length, 6);
    assert.equal(twice.length, 6);
  });

  it('drops any combo that touches an excluded card', () => {
    const combos = expandRangeToCombos(['AA'], ['Ac', 'Ad']);
    // Only the (As, Ah) pairing avoids both excluded cards.
    assert.equal(combos.length, 1);
    assert.deepEqual(combos[0].slice().sort(), ['Ah', 'As']);
  });

  it('combines multiple hand codes without cross-contamination', () => {
    const combos = expandRangeToCombos(['AA', 'KK']);
    assert.equal(combos.length, 12);
  });
});
