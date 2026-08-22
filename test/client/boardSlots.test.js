/**
 * Tests for the board-clearing rule shared by the Odds Calculator and the
 * Range Explorer.
 *
 * This is the first test under `test/client/`. The module it covers lives in
 * `public/` rather than `src/shared/` because the holes-in-fixed-size-arrays
 * board is an editing convention, not a poker rule -- but it is pure, it is
 * importable in Node exactly as it is in the browser, and getting it wrong
 * produces a *plausible wrong answer* rather than an error, which is the
 * category most worth pinning down.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearBoardCard } from '../../public/javascripts/poker/boardSlots.js';

/** A flop, turn and river all dealt. */
function fullBoard() {
  return { flop: ['As', 'Kd', '7c'], turn: ['2h'], river: ['9s'] };
}

/** The flatten both pages apply before sending the board to the API. */
function flatten(board) {
  return [...board.flop, ...board.turn, ...board.river].filter(Boolean);
}

describe('clearBoardCard', () => {
  it('clears the turn and takes the river with it', () => {
    const next = clearBoardCard(fullBoard(), 'turn', 0);

    assert.deepEqual(next.flop, ['As', 'Kd', '7c']);
    assert.deepEqual(next.turn, [null]);
    assert.deepEqual(next.river, [null]);
  });

  it('leaves a board that still reads as the street the user meant', () => {
    // The bug this rule exists for: clear the turn while a river is dealt,
    // and a naive per-slot edit flattens to four cards -- a perfectly legal
    // turn board -- with the river silently sitting in the turn's place. The
    // equity would come back confidently wrong instead of being refused.
    const next = clearBoardCard(fullBoard(), 'turn', 0);

    assert.deepEqual(flatten(next), ['As', 'Kd', '7c'], 'should be back to just the flop');
    assert.equal(flatten(next).length, 3);
  });

  it('clears the rest of the board when a flop card goes, but spares its siblings', () => {
    // The three flop cards are dealt at once, so removing one leaves an
    // incomplete flop the user is mid-edit on -- that is caught later by the
    // street-boundary check, with a real message.
    const next = clearBoardCard(fullBoard(), 'flop', 1);

    assert.deepEqual(next.flop, ['As', null, '7c']);
    assert.deepEqual(next.turn, [null]);
    assert.deepEqual(next.river, [null]);
    assert.equal(flatten(next).length, 2, 'an incomplete board is rejected, not mis-read');
  });

  it('clears the river without disturbing the streets before it', () => {
    const next = clearBoardCard(fullBoard(), 'river', 0);

    assert.deepEqual(next.flop, ['As', 'Kd', '7c']);
    assert.deepEqual(next.turn, ['2h']);
    assert.deepEqual(next.river, [null]);
    assert.deepEqual(flatten(next), ['As', 'Kd', '7c', '2h']);
  });

  it('leaves already-empty later streets alone', () => {
    const board = { flop: ['As', 'Kd', '7c'], turn: [null], river: [null] };
    const next = clearBoardCard(board, 'flop', 0);

    assert.deepEqual(next.flop, [null, 'Kd', '7c']);
    assert.deepEqual(next.turn, [null]);
    assert.deepEqual(next.river, [null]);
  });

  it('returns the board untouched for a street it does not recognise', () => {
    // Without the guard, an unknown street compares greater than every
    // position and wipes the entire board.
    const next = clearBoardCard(fullBoard(), 'fourth-street', 0);

    assert.deepEqual(next, fullBoard());
  });
});
