/**
 * Range notation parse/format tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ALL_HANDS, selectTopPercent } from '../../src/shared/poker/ranges.js';
import { formatRangeString, parseRangeString } from '../../src/shared/poker/rangeNotation.js';

describe('parseRangeString', () => {
  it('parses bare hand codes, comma or whitespace separated', () => {
    assert.deepEqual(parseRangeString('AA, KK JJ').hands.sort(), ['AA', 'JJ', 'KK']);
  });

  it('is case-insensitive', () => {
    assert.deepEqual(parseRangeString('aks, ako').hands.sort(), ['AKo', 'AKs']);
  });

  it('expands a pair "+"', () => {
    assert.deepEqual(parseRangeString('QQ+').hands.sort(), ['AA', 'KK', 'QQ']);
  });

  it('expands a suited "+" fixing the top card', () => {
    const { hands } = parseRangeString('A5s+');
    assert.deepEqual(hands.sort(), ['A5s', 'A6s', 'A7s', 'A8s', 'A9s', 'AJs', 'AKs', 'AQs', 'ATs'].sort());
  });

  it('expands an offsuit "+"', () => {
    assert.deepEqual(parseRangeString('KTo+').hands.sort(), ['KJo', 'KQo', 'KTo']);
  });

  it('expands a pair dash span', () => {
    assert.deepEqual(parseRangeString('77-TT').hands.sort(), ['77', '88', '99', 'TT']);
  });

  it('expands a suited dash span regardless of which side is stronger', () => {
    assert.deepEqual(parseRangeString('A9s-A5s').hands.sort(), parseRangeString('A5s-A9s').hands.sort());
  });

  it('rejects a dash span across different top cards', () => {
    const { hands, errors } = parseRangeString('A5s-K9s');
    assert.deepEqual(hands, []);
    assert.equal(errors.length, 1);
  });

  it('reports an unrecognized token without discarding the rest', () => {
    const { hands, errors } = parseRangeString('AA, not-a-hand, KK');
    assert.deepEqual(hands.sort(), ['AA', 'KK']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /not-a-hand/);
  });

  it('combines multiple tokens without duplicates', () => {
    const { hands } = parseRangeString('QQ+, AKs, KK');
    assert.deepEqual(hands.sort(), ['AA', 'AKs', 'KK', 'QQ']);
  });
});

describe('formatRangeString', () => {
  it('compresses a full pair range with a ceiling into "+"', () => {
    assert.equal(formatRangeString(['AA', 'KK', 'QQ']), 'QQ+');
  });

  it('compresses an interior pair run into a dash span', () => {
    assert.equal(formatRangeString(['TT', '99', '88', '77']), '77-TT');
  });

  it('compresses a suited run reaching the top card into "+"', () => {
    const hands = ['AKs', 'AQs', 'AJs', 'ATs', 'A9s'];
    assert.equal(formatRangeString(hands), 'A9s+');
  });

  it('leaves an isolated hand as a single token', () => {
    assert.equal(formatRangeString(['AKs']), 'AKs');
  });

  it('formats an empty range as an empty string', () => {
    assert.equal(formatRangeString([]), '');
  });

  it('round-trips through parseRangeString for an arbitrary range', () => {
    for (const percent of [0, 5, 15, 30, 50, 100]) {
      const original = new Set(selectTopPercent(percent));
      const formatted = formatRangeString(original);
      const { hands: reparsed, errors } = parseRangeString(formatted);

      assert.deepEqual(errors, [], `percent ${percent} produced parse errors: ${errors}`);
      assert.deepEqual(new Set(reparsed), original, `percent ${percent} did not round-trip`);
    }
  });

  it('round-trips the full 169-hand range', () => {
    const formatted = formatRangeString(ALL_HANDS);
    const { hands: reparsed } = parseRangeString(formatted);
    assert.deepEqual(new Set(reparsed), new Set(ALL_HANDS));
  });
});
