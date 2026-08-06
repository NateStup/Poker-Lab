/**
 * Forced-bet and pot-arithmetic tests.
 *
 * Every expected number here is worked out by hand in the test's own comment,
 * so a failure says which piece of the arithmetic broke rather than just
 * "expected 375, got 275".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeHandDerived, deriveForcedBets, furthestStreet, splitPot } from '../../../src/shared/handLog/actions.js';
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

describe('deriveForcedBets', () => {
  it('posts the blinds off the button, with no antes by default', () => {
    const hand = buildHand({ format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: null, straddleAmount: 0 } });
    const forced = deriveForcedBets(hand);

    assert.deepEqual(forced, [
      { seatNumber: 1, type: 'smallBlind', amount: 1 },
      { seatNumber: 2, type: 'bigBlind', amount: 2 }
    ]);
  });

  it('charges every seat an ante when the format has one', () => {
    const hand = buildHand({
      format: { gameType: 'tournament', smallBlind: 100, bigBlind: 200, ante: 25, straddleSeat: null, straddleAmount: 0 }
    });
    const forced = deriveForcedBets(hand);

    const antes = forced.filter(bet => bet.type === 'ante');
    assert.equal(antes.length, 6, 'all six seats post an ante');
    assert.ok(antes.every(bet => bet.amount === 25));
    // 6 antes of 25 = 150, plus blinds of 100 + 200 = 450 total.
    assert.equal(forced.reduce((sum, bet) => sum + bet.amount, 0), 450);
  });

  it('adds a straddle when one is set', () => {
    const hand = buildHand({
      format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: 3, straddleAmount: 4 }
    });
    const forced = deriveForcedBets(hand);

    assert.deepEqual(forced.at(-1), { seatNumber: 3, type: 'straddle', amount: 4 });
  });

  it('posts a single blind from the button heads-up', () => {
    const hand = buildHand({
      seats: createEmptyHand({ seatCount: 2 }).seats,
      buttonSeat: 0,
      format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: null, straddleAmount: 0 }
    });
    const forced = deriveForcedBets(hand);

    assert.deepEqual(forced, [
      { seatNumber: 0, type: 'smallBlind', amount: 1 },
      { seatNumber: 1, type: 'bigBlind', amount: 2 }
    ]);
  });
});

describe('computeHandDerived', () => {
  it('counts the blinds into the pot before any action is logged', () => {
    const derived = computeHandDerived(buildHand());

    assert.equal(derived.potAfterStreet.preflop, 3, 'blinds of 1 and 2');
    assert.equal(derived.totalPot, 3);
  });

  it('treats an action amount as the street total, not an increment', () => {
    // Seat 3 raises to 6. Seat 2 is the big blind with 2 already in, and
    // calls to 6 -- so the big blind adds 4 more, not another 6.
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
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const derived = computeHandDerived(hand);

    // SB 1 (folded, still in the pot) + BB 6 + raiser 6 = 13.
    assert.equal(derived.totalPot, 13);
    assert.equal(derived.contributionsBySeat[2], 6, 'the big blind put in 6 total, not 2 + 6');
    assert.equal(derived.contributionsBySeat[3], 6);
    assert.equal(derived.contributionsBySeat[1], 1, 'the small blind is still in for its forced bet');
  });

  it('resets street commitment each street, so a postflop bet is not offset by preflop money', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [{ seatNumber: 3, type: 'raise', amount: 6 }, { seatNumber: 2, type: 'call', amount: 6 }],
          notes: ''
        },
        // Both players already have 6 in from preflop; a flop bet of 6 must
        // add another 6 each, not be swallowed as "already committed".
        flop: {
          board: ['As', 'Kd', '7h'],
          actions: [{ seatNumber: 2, type: 'bet', amount: 6 }, { seatNumber: 3, type: 'call', amount: 6 }],
          notes: ''
        },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const derived = computeHandDerived(hand);

    assert.equal(derived.potAfterStreet.preflop, 13);
    assert.equal(derived.potAfterStreet.flop, 25, 'two more bets of 6 on the flop');
    assert.equal(derived.totalPot, 25);
    assert.equal(derived.contributionsBySeat[2], 12);
  });

  it('ignores an amount below what the seat already committed rather than shrinking the pot', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          // The big blind already has 2 in; logging "call 1" is a typo, and
          // must not pull a chip back out of the pot.
          actions: [{ seatNumber: 2, type: 'call', amount: 1 }],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const derived = computeHandDerived(hand);

    assert.equal(derived.totalPot, 3, 'still just the two blinds');
    assert.equal(derived.contributionsBySeat[2], 2);
  });

  it('subtracts contributions from starting stacks and settles the winner', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [{ seatNumber: 3, type: 'raise', amount: 6 }, { seatNumber: 2, type: 'call', amount: 6 }],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      },
      result: { winningSeats: [3], notes: 'took it down' }
    });
    const derived = computeHandDerived(hand);

    assert.equal(derived.stackAfterBySeat[3], 194, 'started with 200, put in 6');
    assert.deepEqual(derived.payouts, [{ seatNumber: 3, amount: 13 }]);
    assert.equal(derived.netBySeat[3], 7, 'won a 13 pot having put in 6');
    assert.equal(derived.netBySeat[2], -6);
    assert.equal(derived.netBySeat[1], -1);
    assert.equal(derived.netBySeat[0], 0, 'a seat that never put money in is flat');
  });

  it('reports every seat as flat when nobody is marked as winning', () => {
    const derived = computeHandDerived(buildHand());
    assert.deepEqual(derived.payouts, [], 'an unfinished log has no payout');
    assert.equal(derived.netBySeat.reduce((sum, net) => sum + net, 0), -3, 'the blinds are still committed');
  });
});

describe('splitPot', () => {
  it('divides a chopped pot evenly', () => {
    assert.deepEqual(splitPot(100, [1, 3]), [
      { seatNumber: 1, amount: 50 },
      { seatNumber: 3, amount: 50 }
    ]);
  });

  it('gives the odd chip to the first winning seat so the split sums to the pot', () => {
    const payouts = splitPot(101, [1, 3]);
    assert.deepEqual(payouts, [
      { seatNumber: 1, amount: 51 },
      { seatNumber: 3, amount: 50 }
    ]);
    assert.equal(payouts.reduce((sum, payout) => sum + payout.amount, 0), 101);
  });

  it('returns nothing when no winner is recorded', () => {
    assert.deepEqual(splitPot(100, []), []);
  });
});

describe('furthestStreet', () => {
  it('reads the furthest street off the revealed board, not the action list', () => {
    const streets = {
      preflop: { board: [], actions: [], notes: '' },
      flop: { board: ['As', 'Kd', '7h'], actions: [], notes: '' },
      turn: { board: ['2c'], actions: [], notes: '' },
      river: { board: [], actions: [], notes: '' }
    };
    assert.equal(furthestStreet(streets), 'turn', 'a street with no logged actions still counts as reached');

    streets.turn.board = [];
    assert.equal(furthestStreet(streets), 'flop');
    streets.flop.board = [];
    assert.equal(furthestStreet(streets), 'preflop');
  });
});
