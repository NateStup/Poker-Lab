/**
 * Forced-bet and pot-arithmetic tests.
 *
 * Every expected number here is worked out by hand in the test's own comment,
 * so a failure says which piece of the arithmetic broke rather than just
 * "expected 375, got 275".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commitIncrement,
  computeHandDerived,
  deriveForcedBets,
  furthestStreet,
  nextToAct,
  splitPot,
  streetBettingState
} from '../../../src/shared/handLog/actions.js';
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

  it('subtracts contributions from starting stacks and settles the last player standing', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [{ seatNumber: 3, type: 'raise', amount: 6 }, { seatNumber: 2, type: 'call', amount: 6 }],
          notes: ''
        },
        // The big blind gives up on the flop, leaving seat 3 alone with it. No
        // winner is stated anywhere -- it is read off the folds.
        flop: { board: ['As', 'Kd', '7h'], actions: [{ seatNumber: 2, type: 'fold', amount: 0 }], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const derived = computeHandDerived(hand);

    assert.deepEqual(derived.winningSeats, [3]);
    assert.equal(derived.stackAfterBySeat[3], 194, 'started with 200, put in 6');
    assert.deepEqual(derived.payouts, [{ seatNumber: 3, amount: 13 }]);
    assert.equal(derived.netBySeat[3], 7, 'won a 13 pot having put in 6');
    assert.equal(derived.netBySeat[2], -6);
    assert.equal(derived.netBySeat[1], -1);
    assert.equal(derived.netBySeat[0], 0, 'a seat that never put money in is flat');
  });

  it('awards nothing while a hand is still ambiguous', () => {
    // Two seats still in, no board, no cards logged: the hand does not say who
    // won it, and guessing would be worse than leaving the pot unawarded.
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
      }
    });
    const derived = computeHandDerived(hand);

    assert.deepEqual(derived.winningSeats, []);
    assert.deepEqual(derived.payouts, []);
    assert.equal(derived.netBySeat.reduce((sum, net) => sum + net, 0), -13, 'everything committed is still in the middle');
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

describe('commitIncrement', () => {
  it('charges only the difference when a seat has already committed', () => {
    assert.equal(commitIncrement(300, 100, 1000), 200, 'a big blind of 100 calling to 300 puts in 200');
  });

  it('never pulls chips back out for an amount below what is already in', () => {
    assert.equal(commitIncrement(50, 100, 1000), 0);
  });

  it('caps an over-large amount at the stack instead of going negative', () => {
    assert.equal(commitIncrement(5000, 0, 600), 600, 'a shove for more than the stack is just all in');
    assert.equal(commitIncrement(5000, 100, 600), 600, 'the cap is what is left, not the total');
  });

  it('gives nothing away from a seat that is already all in', () => {
    assert.equal(commitIncrement(5000, 600, 0), 0);
  });
});

describe('stacks never go negative', () => {
  it('treats a bet bigger than the stack as an all-in for the stack', () => {
    // Seat 3 has 200 behind and is logged raising to 5000 -- typed from memory
    // in tournament chips, say. The pot can only hold chips that existed.
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'raise', amount: 5000 },
            { seatNumber: 2, type: 'call', amount: 5000 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const derived = computeHandDerived(hand);

    assert.equal(derived.contributionsBySeat[3], 200, 'a 200 stack can only put in 200');
    assert.equal(derived.contributionsBySeat[2], 200);
    assert.equal(derived.stackAfterBySeat[3], 0, 'all in, not in debt');
    assert.ok(derived.stackAfterBySeat.every(stack => stack >= 0), 'no seat ends below zero');
    // SB 1 (folded) + two 200 stacks = 401.
    assert.equal(derived.totalPot, 401);
  });

  it('posts what a short stack has when it cannot cover the blind', () => {
    const seats = createEmptyHand({ seatCount: 6 }).seats;
    seats[2] = { ...seats[2], stack: 1 };
    const hand = buildHand({ seats });
    const derived = computeHandDerived(hand);

    assert.equal(derived.contributionsBySeat[2], 1, 'a 1-chip stack posts 1 of the 2 big blind');
    assert.equal(derived.stackAfterBySeat[2], 0);
    assert.equal(derived.totalPot, 2, 'the small blind plus the chip the big blind had');
  });

  it('stops charging a seat that went all in on an earlier street', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [{ seatNumber: 3, type: 'raise', amount: 200 }, { seatNumber: 2, type: 'call', amount: 200 }],
          notes: ''
        },
        // Both are already all in; anything logged after this costs nothing.
        flop: {
          board: ['As', 'Kd', '7h'],
          actions: [{ seatNumber: 2, type: 'bet', amount: 100 }, { seatNumber: 3, type: 'call', amount: 100 }],
          notes: ''
        },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const derived = computeHandDerived(hand);

    assert.equal(derived.potAfterStreet.flop, derived.potAfterStreet.preflop, 'no chips left to bet');
    assert.equal(derived.contributionsBySeat[2], 200);
  });
});

describe('streetBettingState', () => {
  const hand = buildHand({
    streets: {
      preflop: {
        board: [],
        actions: [
          { seatNumber: 3, type: 'raise', amount: 6 },
          { seatNumber: 4, type: 'fold', amount: 0 },
          { seatNumber: 2, type: 'call', amount: 6 }
        ],
        notes: ''
      },
      flop: { board: ['As', 'Kd', '7h'], actions: [{ seatNumber: 2, type: 'bet', amount: 10 }], notes: '' },
      turn: { board: [], actions: [], notes: '' },
      river: { board: [], actions: [], notes: '' }
    }
  });

  it('reports what it costs to call partway through a street', () => {
    // After the raise to 6, before the big blind has acted.
    const state = streetBettingState(hand, 'preflop', 1);

    assert.equal(state.highestBet, 6);
    assert.equal(state.committed[2], 2, 'the big blind still has just its blind out');
    assert.equal(state.highestBet - state.committed[2], 4, 'so calling costs 4 more');
    assert.equal(state.pot, 9, 'SB 1 + BB 2 + the raise to 6');
  });

  it('carries folds and stacks forward from earlier streets', () => {
    const state = streetBettingState(hand, 'flop');

    assert.equal(state.folded[4], true, 'folded preflop, still folded');
    assert.equal(state.committed[2], 10, 'the flop bet, not the preflop money');
    assert.equal(state.stacks[2], 200 - 16, 'six preflop and ten on the flop');
    assert.equal(state.pot, 23);
  });

  it('marks a seat with nothing behind as all in', () => {
    const allIn = buildHand({
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 3, type: 'raise', amount: 200 }], notes: '' },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const state = streetBettingState(allIn, 'preflop');

    assert.equal(state.allIn[3], true);
    assert.equal(state.stacks[3], 0);
    assert.equal(state.allIn[0], false, 'a seat that never put chips in is not all in');
  });
});

describe('nextToAct', () => {
  it('opens the preflop action with the seat after the big blind', () => {
    assert.equal(nextToAct(buildHand(), 'preflop', 0), 3, 'UTG, three seats off the button');
  });

  it('opens every later street with the small blind', () => {
    assert.equal(nextToAct(buildHand(), 'flop', 0), 1);
  });

  it('gives the button the first move preflop heads-up', () => {
    const headsUp = buildHand({ seats: createEmptyHand({ seatCount: 2 }).seats, buttonSeat: 0 });
    assert.equal(nextToAct(headsUp, 'preflop', 0), 0, 'the button is the small blind and acts first');
    assert.equal(nextToAct(headsUp, 'flop', 0), 1, 'and last on every street after it');
  });

  it('moves round the table as actions are logged', () => {
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'raise', amount: 6 },
            { seatNumber: 4, type: 'fold', amount: 0 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'preflop', 1), 4, 'the seat after the raiser');
    assert.equal(nextToAct(hand, 'preflop', 2), 5, 'which folds, so on round to the next');
  });

  it('closes the round once the last live seat has called and matched, with no raise this street', () => {
    // UTG folds; HJ calls the big blind (2); CO, BTN and SB fold; BB checks,
    // matching. HJ and BB are the only live seats, and both have acted since
    // the street began (there was never a bet or raise to reopen it) -- the
    // round is closed. This is the same underlying closure question as the
    // raised case, in a no-raise shape: matching the number isn't what closes
    // the action, having acted since the last aggression is.
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'fold', amount: 0 },
            { seatNumber: 4, type: 'call', amount: 2 },
            { seatNumber: 5, type: 'fold', amount: 0 },
            { seatNumber: 0, type: 'fold', amount: 0 },
            { seatNumber: 1, type: 'fold', amount: 0 },
            { seatNumber: 2, type: 'check', amount: 0 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'preflop'), null, 'both remaining live seats matched and have acted -- the round is closed');
    assert.equal(nextToAct(hand, 'flop', 0), 2, 'a new street reopens action -- it starts fresh on the first live seat after the button');
  });

  it('closes the round once folds narrow the field to two matched live seats after a raise', () => {
    // UTG, HJ and CO fold; BTN opens to 6; SB folds; BB calls 6. This is the
    // original bug report's exact shape: BTN and BB are the only live seats
    // left, and both have acted since BTN's raise.
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'fold', amount: 0 },
            { seatNumber: 4, type: 'fold', amount: 0 },
            { seatNumber: 5, type: 'fold', amount: 0 },
            { seatNumber: 0, type: 'raise', amount: 6 },
            { seatNumber: 1, type: 'fold', amount: 0 },
            { seatNumber: 2, type: 'call', amount: 6 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'preflop'), null, 'both remaining seats matched the raise -- the round is closed');
  });

  it('still owes the big blind a turn when everyone limps to it, even though committed already equals the highest bet', () => {
    // UTG, HJ, CO, BTN and SB all limp in for 2, matching the big blind's own
    // forced bet -- but the big blind itself hasn't voluntarily acted yet.
    // Matching the number by default from posting it is not the same as
    // having had a turn.
    const hand = buildHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'call', amount: 2 },
            { seatNumber: 4, type: 'call', amount: 2 },
            { seatNumber: 5, type: 'call', amount: 2 },
            { seatNumber: 0, type: 'call', amount: 2 },
            { seatNumber: 1, type: 'call', amount: 2 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'preflop'), 2, 'the big blind still gets its option');
  });

  it('reopens action for every seat that acted before the last raise, not just whoever is next in line', () => {
    // Three-handed flop: SB bets, BB calls, BTN raises. SB and BB both acted
    // before BTN's raise, so both are owed a turn again -- the suggestion
    // must land back on SB (the first of them in acting order), not fall
    // through to whichever seat is positionally "next" after BTN.
    const seats = createEmptyHand({ seatCount: 3 }).seats;
    const hand = buildHand({
      seats,
      buttonSeat: 0,
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: {
          board: ['2c', '7d', 'Jh'],
          actions: [
            { seatNumber: 1, type: 'bet', amount: 10 },
            { seatNumber: 2, type: 'call', amount: 10 },
            { seatNumber: 0, type: 'raise', amount: 30 }
          ],
          notes: ''
        },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'flop'), 1, 'SB acted before the raise, so it is owed another turn');
  });

  it('does not close a street of only checks until the last live seat has checked', () => {
    const hand = buildHand({
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: {
          board: ['2c', '7d', 'Jh'],
          actions: [
            { seatNumber: 1, type: 'check', amount: 0 },
            { seatNumber: 2, type: 'check', amount: 0 },
            { seatNumber: 3, type: 'check', amount: 0 },
            { seatNumber: 4, type: 'check', amount: 0 },
            { seatNumber: 5, type: 'check', amount: 0 },
            { seatNumber: 0, type: 'check', amount: 0 }
          ],
          notes: ''
        },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'flop', 5), 0, 'the button has not checked yet -- still owed a turn');
    assert.equal(nextToAct(hand, 'flop', 6), null, 'every live seat has now checked -- the round is closed');
  });

  it('excludes an all-in seat even when the wraparound would otherwise land on it', () => {
    // BTN shoves all in for 50; SB, covering, calls; BB folds. BTN is out of
    // chips and excluded regardless of turn order; SB has already acted
    // since BTN's raise. Nobody is left to act -- and in particular the
    // all-in button must not be offered just because it's next in the
    // rotation.
    const seats = createEmptyHand({ seatCount: 3 }).seats.map((seat, index) => ({
      ...seat,
      stack: index === 0 ? 50 : 200
    }));
    const hand = buildHand({
      seats,
      buttonSeat: 0,
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 50 },
            { seatNumber: 1, type: 'call', amount: 50 },
            { seatNumber: 2, type: 'fold', amount: 0 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'preflop'), null, 'the all-in button and the folded blind are both excluded');
  });

  it('has nobody to offer once everyone is all in', () => {
    const seats = createEmptyHand({ seatCount: 2 }).seats.map(seat => ({ ...seat, stack: 100 }));
    const hand = buildHand({
      seats,
      buttonSeat: 0,
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 100 },
            { seatNumber: 1, type: 'call', amount: 100 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(nextToAct(hand, 'flop'), null);
  });
});
