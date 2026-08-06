/**
 * Position derivation tests.
 *
 * Assertions are provable by hand: the button's own seat always reads BTN,
 * and the blinds sit immediately to its left -- except heads-up, which is
 * the case that breaks naive "seat after the button" logic.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bigBlindSeat, derivePositions, smallBlindSeat } from '../../../src/shared/handLog/positions.js';

describe('derivePositions', () => {
  it('puts the button on the button seat and the blinds to its left', () => {
    const positions = derivePositions(6, 0);
    assert.deepEqual(positions, ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
  });

  it('rotates with the button, wrapping around the table', () => {
    const positions = derivePositions(6, 4);
    assert.equal(positions[4], 'BTN', 'the button seat always reads BTN');
    assert.equal(positions[5], 'SB', 'the next seat clockwise posts the small blind');
    assert.equal(positions[0], 'BB', 'and the blinds wrap past the end of the table');
    assert.deepEqual(positions, ['BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB']);
  });

  it('assigns a distinct position to every seat at every table size', () => {
    for (let seatCount = 2; seatCount <= 10; seatCount += 1) {
      for (let button = 0; button < seatCount; button += 1) {
        const positions = derivePositions(seatCount, button);
        assert.equal(positions.length, seatCount);
        assert.equal(new Set(positions).size, seatCount, `${seatCount}-handed, button on ${button}: duplicate positions`);
        assert.ok(!positions.includes(undefined), 'every seat must be labelled');
      }
    }
  });

  it('treats the button as the small blind heads-up', () => {
    const positions = derivePositions(2, 0);
    assert.deepEqual(positions, ['BTN/SB', 'BB']);
    assert.equal(smallBlindSeat(positions), 0, 'the button posts the small blind heads-up');
    assert.equal(bigBlindSeat(positions), 1);
  });

  it('rejects an unsupported table size', () => {
    assert.throws(() => derivePositions(1, 0), RangeError);
    assert.throws(() => derivePositions(11, 0), RangeError);
  });
});

describe('smallBlindSeat / bigBlindSeat', () => {
  it('finds the blinds at a full table', () => {
    const positions = derivePositions(9, 3);
    assert.equal(smallBlindSeat(positions), 4);
    assert.equal(bigBlindSeat(positions), 5);
  });
});
