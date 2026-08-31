/**
 * Replay-timeline tests.
 *
 * The load-bearing property is that the walk and the totals never disagree:
 * the last frame's pot must equal `computeHandDerived().totalPot`, because two
 * pieces of arithmetic over the same actions is exactly the split this
 * codebase keeps getting bitten by. The rest is about the states *between*
 * those totals -- chips in front of a seat, folds sticking, streets sweeping.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeHandDerived } from '../../../src/shared/handLog/actions.js';
import { buildReplayFrames } from '../../../src/shared/handLog/replay.js';
import { createEmptyHand, validateHandLogRequest } from '../../../src/shared/handLog/validation.js';

/**
 * Build a valid hand, applying `overrides` on top of the empty template.
 * @param {object} [overrides]
 * @returns {object}
 */
function buildHand(overrides = {}) {
  const base = createEmptyHand({ seatCount: 6 });
  const { valid, errors, value } = validateHandLogRequest({ ...base, name: 'Test hand', ...overrides });
  assert.ok(valid, `test fixture must be valid: ${errors.join(' ')}`);
  return value;
}

/** A six-handed hand that goes preflop -> flop -> turn with a fold in it. */
function playedHand() {
  return buildHand({
    streets: {
      preflop: {
        board: [],
        actions: [
          { seatNumber: 3, type: 'raise', amount: 6 },
          { seatNumber: 1, type: 'fold', amount: 0 },
          { seatNumber: 2, type: 'call', amount: 6 }
        ],
        notes: 'Opened from UTG with a real hand.'
      },
      flop: {
        board: ['As', 'Kd', '7h'],
        actions: [
          { seatNumber: 2, type: 'check', amount: 0 },
          { seatNumber: 3, type: 'bet', amount: 8 },
          { seatNumber: 2, type: 'call', amount: 8 }
        ],
        notes: 'Top pair, betting for value.'
      },
      turn: {
        board: ['2c'],
        actions: [{ seatNumber: 2, type: 'check', amount: 0 }, { seatNumber: 3, type: 'check', amount: 0 }],
        notes: ''
      },
      river: { board: [], actions: [], notes: '' }
    },
    result: { notes: 'Held up.' }
  });
}

describe('buildReplayFrames', () => {
  it('opens on the blinds, before anyone has acted', () => {
    const frames = buildReplayFrames(buildHand());
    const first = frames[0];

    assert.equal(first.kind, 'deal');
    assert.equal(first.street, 'preflop');
    assert.deepEqual(first.board, [], 'no community cards preflop');
    assert.equal(first.bets[1], 1, 'small blind is out in front, not yet in the pot');
    assert.equal(first.bets[2], 2);
    assert.equal(first.pot, 3, 'the pot counts chips still in front of a seat');
    assert.deepEqual(first.lastActions[1], { type: 'post', amount: 1 });
    assert.equal(first.lastActions[0], null, 'a seat that has done nothing has no chip label');
    assert.equal(first.stacks[2], 198, 'started with 200, posted 2');
  });

  it('emits one frame per beat: each street dealt, each action, then the settle', () => {
    const frames = buildReplayFrames(playedHand());

    // 3 deal frames (preflop, flop, turn) + 8 logged actions + 1 settle.
    assert.equal(frames.length, 12);
    assert.deepEqual(
      frames.map(frame => frame.kind),
      ['deal', 'action', 'action', 'action', 'deal', 'action', 'action', 'action', 'deal', 'action', 'action', 'result']
    );
    assert.deepEqual(frames.map(frame => frame.index), [...Array(12).keys()], 'frames are indexed in order');
  });

  it('skips streets the hand never reached', () => {
    const frames = buildReplayFrames(playedHand());
    assert.ok(!frames.some(frame => frame.street === 'river'), 'the river was never dealt');
  });

  it('reveals the board a street at a time', () => {
    const frames = buildReplayFrames(playedHand());
    const dealFrames = frames.filter(frame => frame.kind === 'deal');

    assert.deepEqual(dealFrames.map(frame => frame.dealt), [[], ['As', 'Kd', '7h'], ['2c']]);
    assert.deepEqual(dealFrames.at(-1).board, ['As', 'Kd', '7h', '2c'], 'the board accumulates');
    assert.deepEqual(frames[1].board, [], 'a preflop action still sees no board');
  });

  it('sweeps the chips in front of each seat into the pot between streets', () => {
    const frames = buildReplayFrames(playedHand());
    const lastPreflop = frames[3];
    const flopDeal = frames[4];

    assert.equal(lastPreflop.bets[3], 6, 'the raise is still in front of the raiser');
    assert.deepEqual(flopDeal.bets, [0, 0, 0, 0, 0, 0], 'the dealer pulled the street in');
    assert.equal(flopDeal.pot, lastPreflop.pot, 'sweeping chips does not change the pot total');
    assert.equal(flopDeal.pot, 13, 'SB 1 + BB 6 + raiser 6');
  });

  it('keeps a fold in effect for the rest of the hand', () => {
    const frames = buildReplayFrames(playedHand());
    const foldFrame = frames[2];

    assert.equal(foldFrame.folded[1], true);
    assert.ok(frames.slice(2).every(frame => frame.folded[1]), 'a folded seat never comes back');
    assert.deepEqual(frames.at(-1).lastActions[1], { type: 'fold', amount: 0 },
      "a folded seat's label survives the street sweep so you can see who is out");
    assert.equal(frames.at(-1).lastActions[2], null, 'a seat still in the hand starts each street clean');
  });

  it('records the increment a call actually cost on top of the blind', () => {
    const frames = buildReplayFrames(playedHand());
    const bigBlindCall = frames[3];

    assert.equal(bigBlindCall.action.type, 'call');
    assert.equal(bigBlindCall.action.amount, 6, 'the logged amount is the street total');
    assert.equal(bigBlindCall.action.increment, 4, 'but only 4 more went in, over the 2 already posted');
    assert.equal(bigBlindCall.stacks[2], 194);
  });

  it('ends on a settle frame that matches the derived total', () => {
    const hand = playedHand();
    const frames = buildReplayFrames(hand);
    const derived = computeHandDerived(hand);
    const last = frames.at(-1);

    assert.equal(last.kind, 'result');
    assert.equal(last.street, 'turn', 'the hand ended on the turn');
    assert.equal(last.pot, derived.totalPot, 'the walk and the totals agree');
    assert.deepEqual(last.payouts, derived.payouts);
    assert.deepEqual(last.bets, [0, 0, 0, 0, 0, 0], 'everything is in the middle by the end');
    assert.equal(last.notes, 'Held up.', 'the settle frame carries the result notes');
    // Two seats are still in on the turn with no cards logged, so the hand
    // does not say who won it and nobody is paid.
    assert.deepEqual(last.payouts, []);
    assert.equal(last.stacks[3], 200 - 14, 'six preflop and eight on the flop');
  });

  it('pays the last player standing, with no winner recorded anywhere', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'raise', amount: 6 },
            { seatNumber: 2, type: 'call', amount: 6 }
          ],
          notes: ''
        },
        flop: {
          board: ['As', 'Kd', '7h'],
          actions: [
            { seatNumber: 2, type: 'check', amount: 0 },
            { seatNumber: 3, type: 'bet', amount: 8 },
            { seatNumber: 2, type: 'fold', amount: 0 }
          ],
          notes: ''
        },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const last = buildReplayFrames(hand).at(-1);

    assert.deepEqual(last.winningSeats, [3], 'read off the fold, not stated');
    // SB 1 + seat 2's 6 + seat 3's 6 and 8 = 21.
    assert.deepEqual(last.payouts, [{ seatNumber: 3, amount: 21 }]);
    assert.equal(last.stacks[3], 200 - 14 + 21, 'the winner is paid on the final frame');
  });

  it('carries each street\'s notes on every frame of that street', () => {
    const frames = buildReplayFrames(playedHand());
    const flopFrames = frames.filter(frame => frame.street === 'flop');

    assert.ok(flopFrames.length > 1);
    assert.ok(flopFrames.every(frame => frame.notes === 'Top pair, betting for value.'));
  });

  it('still produces a readable timeline for a hand with no action and no winner', () => {
    const frames = buildReplayFrames(buildHand());

    assert.equal(frames.length, 2, 'the preflop deal and the settle');
    assert.deepEqual(frames.at(-1).payouts, []);
    assert.equal(frames.at(-1).pot, 3, 'the blinds are still a pot');
  });

  it('never lets the pot shrink from one frame to the next', () => {
    const frames = buildReplayFrames(buildHand({
      streets: {
        // A "call 1" from a big blind already in for 2 is a typo, not chips
        // coming back off the table.
        preflop: { board: [], actions: [{ seatNumber: 2, type: 'call', amount: 1 }], notes: '' },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));

    for (let i = 1; i < frames.length; i += 1) {
      assert.ok(frames[i].pot >= frames[i - 1].pot, `frame ${i} shrank the pot`);
    }
    assert.equal(frames.at(-1).pot, 3);
  });
});
