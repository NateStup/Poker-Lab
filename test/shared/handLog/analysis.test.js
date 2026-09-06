/**
 * Tests for reading a logged hand as a poker situation.
 *
 * The interesting cases are all about *when* an analysis applies rather than
 * the numbers it produces: an all-in run-out that isn't one because a player
 * still has chips to bet, a showdown with nothing to show because the villain's
 * cards were never logged, and an evaluation that disagrees with what the user
 * recorded as the result -- which must be reported, never corrected.
 *
 * Equity assertions stick to spots provable by hand (a hand drawing dead is 0%,
 * identical hands chop) rather than published percentages, per the project's
 * testing note.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allInSeats,
  contestingSeats,
  determineWinners,
  evaluateShowdown,
  findAllInRunout,
  isRunoutSpot,
  liveSeats,
  runoutEquity
} from '../../../src/shared/handLog/analysis.js';
import { buildReplayFrames } from '../../../src/shared/handLog/replay.js';
import { createEmptyHand, validateHandLogRequest } from '../../../src/shared/handLog/validation.js';

/**
 * A heads-up hand with the given overrides, validated the way the API would.
 * @param {object} overrides
 * @returns {object}
 */
function buildHand(overrides = {}) {
  const base = createEmptyHand({ seatCount: 2 });
  const { valid, errors, value } = validateHandLogRequest({ ...base, name: 'Analysis test', ...overrides });
  assert.ok(valid, `test fixture must be valid: ${errors.join(' ')}`);
  return value;
}

/**
 * Both players get it all in preflop for their whole 200-chip stack.
 * @param {object} [options]
 * @param {string[]} [options.heroCards]
 * @param {string[]} [options.villainCards]
 * @param {object} [options.streets] override the streets wholesale
 * @param {number[]} [options.winningSeats]
 * @returns {object}
 */
function allInHand({
  heroCards = ['As', 'Ah'],
  villainCards = ['Kd', 'Kc'],
  streets
} = {}) {
  const seats = createEmptyHand({ seatCount: 2 }).seats;
  seats[0] = { ...seats[0], name: 'Hero', cards: heroCards, isHero: true };
  seats[1] = { ...seats[1], name: 'Villain', cards: villainCards, isHero: false };

  return buildHand({
    seats,
    buttonSeat: 0,
    streets: streets || {
      preflop: {
        board: [],
        actions: [
          { seatNumber: 0, type: 'raise', amount: 200 },
          { seatNumber: 1, type: 'call', amount: 200 }
        ],
        notes: ''
      },
      flop: { board: [], actions: [], notes: '' },
      turn: { board: [], actions: [], notes: '' },
      river: { board: [], actions: [], notes: '' }
    },
    result: { notes: '' }
  });
}

describe('liveSeats and allInSeats', () => {
  it('drops a seat once it folds, and counts a seat with nothing behind as all in', () => {
    const hand = allInHand();
    const frames = buildReplayFrames(hand);
    const last = frames.at(-1);

    assert.deepEqual(liveSeats(last), [0, 1]);
    assert.deepEqual(allInSeats(last), [0, 1], 'both put their whole 200 in');
  });

  it('does not call a seat all in just because it never had chips', () => {
    const seats = createEmptyHand({ seatCount: 2 }).seats;
    seats[0] = { ...seats[0], stack: 0, isHero: true };
    const hand = buildHand({ seats, format: { gameType: 'cash', smallBlind: 0, bigBlind: 0, ante: 0, straddleSeat: null, straddleAmount: 0 } });

    assert.deepEqual(allInSeats(buildReplayFrames(hand).at(-1)), [], 'no chips committed, so no all-in');
  });
});

describe('findAllInRunout', () => {
  it('finds the run-out once the money is in and cards are still to come', () => {
    const frames = buildReplayFrames(allInHand());
    const runout = findAllInRunout(allInHand(), frames.at(-1));

    assert.ok(runout);
    assert.deepEqual(runout.seats, [0, 1]);
    assert.equal(runout.cardsToCome, 5, 'a preflop all-in has the whole board to come');
  });

  it('counts down the cards to come as the board is dealt', () => {
    const hand = allInHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: ['2c', '7d', '9h'], actions: [], notes: '' },
        turn: { board: ['Jd'], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const frames = buildReplayFrames(hand);

    assert.equal(findAllInRunout(hand, frames.find(frame => frame.street === 'flop')).cardsToCome, 2);
    assert.equal(findAllInRunout(hand, frames.find(frame => frame.street === 'turn')).cardsToCome, 1);
  });

  it('treats an all-in called by a covering stack as a run-out', () => {
    // Only the hero is all in, but the villain has nobody left to bet at, so
    // the hand runs out exactly as if both were -- which is why the rule is
    // "at most one live seat with chips", not "everyone is all in".
    const seats = createEmptyHand({ seatCount: 2 }).seats;
    seats[0] = { ...seats[0], stack: 200, cards: ['As', 'Ah'], isHero: true };
    seats[1] = { ...seats[1], stack: 1000, cards: ['Kd', 'Kc'] };

    const hand = buildHand({
      seats,
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    const runout = findAllInRunout(hand, buildReplayFrames(hand).at(-1));
    assert.ok(runout, 'one covering stack is still a run-out');
    assert.deepEqual(runout.seats, [0, 1], 'both hands are contesting it');
  });

  it('is not a run-out three-handed while two players still have chips', () => {
    const seats = createEmptyHand({ seatCount: 3 }).seats;
    seats[0] = { ...seats[0], stack: 200, cards: ['As', 'Ah'], isHero: true };
    seats[1] = { ...seats[1], stack: 1000, cards: ['Kd', 'Kc'] };
    seats[2] = { ...seats[2], stack: 1000, cards: ['Qd', 'Qc'] };

    const hand = buildHand({
      seats,
      buttonSeat: 0,
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 },
            { seatNumber: 2, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });

    assert.equal(findAllInRunout(hand, buildReplayFrames(hand).at(-1)), null);
  });

  it('waits for the shove to be called before it is a run-out', () => {
    // Ada shoves, Ben folds, and the hero has not acted yet. Only the hero has
    // chips at that point, so a stacks-only rule would call this a run-out and
    // turn Ada's cards over while the hero is still deciding.
    const seats = createEmptyHand({ seatCount: 3 }).seats;
    seats[0] = { ...seats[0], name: 'Hero', stack: 500, cards: ['As', 'Ks'], isHero: true };
    seats[1] = { ...seats[1], name: 'Ada', stack: 500, cards: ['Qd', 'Qc'] };
    seats[2] = { ...seats[2], name: 'Ben', stack: 500, cards: ['7h', '8h'] };

    const hand = buildHand({
      seats,
      buttonSeat: 0,
      format: { gameType: 'cash', smallBlind: 5, bigBlind: 10, ante: 0, straddleSeat: null, straddleAmount: 0 },
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 30 },
            { seatNumber: 1, type: 'raise', amount: 500 },
            { seatNumber: 2, type: 'fold', amount: 0 },
            { seatNumber: 0, type: 'call', amount: 500 }
          ],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const frames = buildReplayFrames(hand);

    const benFolds = frames[3];
    assert.equal(benFolds.action.type, 'fold');
    assert.equal(isRunoutSpot(benFolds), false, 'the hero still owes 470 and could fold');

    const heroCalls = frames[4];
    assert.equal(heroCalls.action.type, 'call');
    assert.equal(isRunoutSpot(heroCalls), true, 'now the money is matched');
  });

  it('stays a run-out spot after the last card, even though there is no equity left to show', () => {
    // What keeps cards that were turned over from flipping back down on the
    // river: the equity goes away, the situation does not.
    const hand = allInHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: ['2c', '7d', '9h'], actions: [], notes: '' },
        turn: { board: ['Jd'], actions: [], notes: '' },
        river: { board: ['3s'], actions: [], notes: '' }
      }
    });
    const frames = buildReplayFrames(hand);

    assert.ok(frames.every(frame => frame.street === 'preflop' || isRunoutSpot(frame)));
    assert.equal(findAllInRunout(hand, frames.at(-1)), null, 'but nothing is left to come');
  });

  it('has nothing to report once the board is complete', () => {
    const hand = allInHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: ['2c', '7d', '9h'], actions: [], notes: '' },
        turn: { board: ['Jd'], actions: [], notes: '' },
        river: { board: ['3s'], actions: [], notes: '' }
      }
    });

    assert.equal(findAllInRunout(hand, buildReplayFrames(hand).at(-1)), null, 'no cards to come');
  });

  it('has nothing to report when a holding was never logged', () => {
    const hand = allInHand({ villainCards: [null, null] });
    assert.equal(findAllInRunout(hand, buildReplayFrames(hand).at(-1)), null);
  });
});

describe('runoutEquity', () => {
  it('gives a hand drawing dead no equity and the winner all of it', () => {
    // Hero has four aces on the turn. No river card gives the villain a win
    // or a chop, so this is 100/0 without needing a published percentage.
    const hand = allInHand({
      heroCards: ['As', 'Ah'],
      villainCards: ['Kd', 'Kc'],
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: ['Ac', 'Ad', '7h'], actions: [], notes: '' },
        turn: { board: ['2c'], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const frame = buildReplayFrames(hand).at(-1);
    const equity = runoutEquity(hand, frame, findAllInRunout(hand, frame));

    assert.equal(equity.method, 'exact', 'one card to come is enumerated, not sampled');
    assert.equal(equity.seats[0].equity, 1);
    assert.equal(equity.seats[1].equity, 0);
  });

  it('splits equity evenly between two hands that must chop', () => {
    // Both players play the same board: a royal flush in spades.
    const hand = allInHand({
      heroCards: ['2c', '3c'],
      villainCards: ['2d', '3d'],
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'call', amount: 200 }
          ],
          notes: ''
        },
        flop: { board: ['As', 'Ks', 'Qs'], actions: [], notes: '' },
        turn: { board: ['Js'], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    });
    const frame = buildReplayFrames(hand).at(-1);
    const equity = runoutEquity(hand, frame, findAllInRunout(hand, frame));

    assert.equal(equity.seats[0].equity, 0.5);
    assert.equal(equity.seats[1].equity, 0.5);
  });

  it('reports every contesting seat, and equity that sums to one', () => {
    const hand = allInHand();
    const frame = buildReplayFrames(hand).at(-1);
    const equity = runoutEquity(hand, frame, findAllInRunout(hand, frame));

    assert.deepEqual(equity.seats.map(seat => seat.seatNumber), [0, 1]);
    const total = equity.seats.reduce((sum, seat) => sum + seat.equity, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `equity should sum to 1, got ${total}`);
    assert.ok(equity.seats[0].equity > equity.seats[1].equity, 'aces are ahead of kings');
  });
});

describe('contestingSeats and determineWinners', () => {
  /** Six-handed, so there are seats that can go unmentioned. */
  function sixHanded(overrides) {
    const base = createEmptyHand({ seatCount: 6 });
    const { valid, errors, value } = validateHandLogRequest({ ...base, name: 'Six handed', ...overrides });
    assert.ok(valid, `test fixture must be valid: ${errors.join(' ')}`);
    return value;
  }

  const noAction = { board: [], actions: [], notes: '' };

  it('treats a seat that never acts and has no cards as not in the hand', () => {
    // "I raised and everyone folded" is logged as one action. Without this,
    // five silent seats would read as live and the pot could never be awarded.
    const hand = sixHanded({
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 3, type: 'raise', amount: 6 }], notes: '' },
        flop: { ...noAction },
        turn: { ...noAction },
        river: { ...noAction }
      }
    });

    assert.deepEqual(contestingSeats(hand), [3]);
    assert.deepEqual(determineWinners(hand), [3], 'the only seat in the hand takes it');
  });

  it('keeps a seat whose cards were logged even if it never acted', () => {
    const seats = createEmptyHand({ seatCount: 6 }).seats;
    seats[5] = { ...seats[5], cards: ['Qs', 'Qh'] };
    const hand = sixHanded({
      seats,
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 3, type: 'raise', amount: 6 }], notes: '' },
        flop: { ...noAction },
        turn: { ...noAction },
        river: { ...noAction }
      }
    });

    assert.deepEqual(contestingSeats(hand), [3, 5]);
    assert.deepEqual(determineWinners(hand), [], 'two seats in, no board -- undecided');
  });

  it('drops a seat the moment it folds, whatever it did before', () => {
    const hand = sixHanded({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'raise', amount: 6 },
            { seatNumber: 4, type: 'call', amount: 6 },
            { seatNumber: 4, type: 'fold', amount: 0 }
          ],
          notes: ''
        },
        flop: { ...noAction },
        turn: { ...noAction },
        river: { ...noAction }
      }
    });

    assert.deepEqual(contestingSeats(hand), [3]);
    assert.deepEqual(determineWinners(hand), [3]);
  });

  it('will not name a winner when a live seat has no cards logged', () => {
    const seats = createEmptyHand({ seatCount: 6 }).seats;
    seats[3] = { ...seats[3], cards: ['As', 'Ks'], isHero: true };
    seats[0] = { ...seats[0], isHero: false };
    const hand = sixHanded({
      seats,
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 3, type: 'raise', amount: 6 },
            { seatNumber: 4, type: 'call', amount: 6 }
          ],
          notes: ''
        },
        flop: { board: ['2c', '7d', '9h'], actions: [], notes: '' },
        turn: { board: ['Jd'], actions: [], notes: '' },
        river: { board: ['3s'], actions: [], notes: '' }
      }
    });

    assert.deepEqual(contestingSeats(hand), [3, 4]);
    assert.deepEqual(determineWinners(hand), [], 'seat 4 got to the river with no cards on record');
  });

  it('will not name a winner off a board that is only half dealt', () => {
    // Built by hand rather than through `validateHandLogRequest`, which is the
    // whole point: validation strips the `null` holes, so a *stored* hand can
    // never reach this state. `HandBuilderForm` renders live totals from the
    // unsaved hand on every keystroke, and the editor pre-sizes each street's
    // board to its full width -- so a flop holding one real card is an array
    // of length 3, and counting slots made a three-card board look complete.
    const hand = createEmptyHand({ seatCount: 2 });
    hand.seats[0] = { ...hand.seats[0], cards: ['Ah', 'Kd'], stack: 1000, isHero: true };
    hand.seats[1] = { ...hand.seats[1], cards: ['Qs', 'Qc'], stack: 1000, isHero: false };
    hand.streets.preflop.actions = [
      { seatNumber: 0, type: 'raise', amount: 100 },
      { seatNumber: 1, type: 'call', amount: 100 }
    ];
    hand.streets.flop.board = ['2c', null, null];
    hand.streets.turn.board = ['7d'];
    hand.streets.river.board = ['9h'];

    assert.deepEqual(contestingSeats(hand), [0, 1], 'both seats are still in it');
    assert.deepEqual(
      determineWinners(hand),
      [],
      'five slots but three real cards -- the hand does not say who won yet'
    );

    // The same hand, once the flop is genuinely finished, still settles.
    hand.streets.flop.board = ['2c', '5s', 'Jd'];
    assert.deepEqual(determineWinners(hand), [1], 'queens beat ace-high on 2c5sJd7d9h');
  });
});

describe('evaluateShowdown', () => {
  /** A completed board both players saw. */
  const runOutStreets = {
    preflop: {
      board: [],
      actions: [
        { seatNumber: 0, type: 'raise', amount: 200 },
        { seatNumber: 1, type: 'call', amount: 200 }
      ],
      notes: ''
    },
    flop: { board: ['Kh', 'Qd', '7c'], actions: [], notes: '' },
    turn: { board: ['Ks'], actions: [], notes: '' },
    river: { board: ['2d'], actions: [], notes: '' }
  };

  it('names each hand shown down and picks the winner', () => {
    const hand = allInHand({
      heroCards: ['Ac', 'Kd'],
      villainCards: ['Qs', 'Qh'],
      streets: runOutStreets
    });
    const showdown = evaluateShowdown(hand, buildReplayFrames(hand).at(-1));

    assert.equal(showdown.seats[0].description, 'Three of a kind, kings');
    assert.equal(showdown.seats[1].description, 'Full house, queens full of kings');
    assert.deepEqual(showdown.winningSeats, [1]);
    assert.equal(showdown.seats[1].isWinner, true);
  });

  it('reports a chop as both seats winning', () => {
    const hand = allInHand({
      heroCards: ['Ac', 'Ad'],
      villainCards: ['As', 'Ah'],
      streets: runOutStreets
    });
    const showdown = evaluateShowdown(hand, buildReplayFrames(hand).at(-1));

    assert.deepEqual(showdown.winningSeats, [0, 1]);
  });

  it('awards the pot to the hand it names, with nothing stated by the user', () => {
    // The one reading: the seat `evaluateShowdown` calls the winner is the
    // seat `determineWinners` pays, because they are the same evaluation.
    const hand = allInHand({
      heroCards: ['Ac', 'Kd'],
      villainCards: ['Qs', 'Qh'],
      streets: runOutStreets
    });
    const showdown = evaluateShowdown(hand, buildReplayFrames(hand).at(-1));

    assert.deepEqual(determineWinners(hand), showdown.winningSeats);
    assert.deepEqual(determineWinners(hand), [1]);
  });

  it('has nothing to show when the villain\'s cards were never logged', () => {
    const hand = allInHand({ villainCards: [null, null], streets: runOutStreets });
    assert.equal(evaluateShowdown(hand, buildReplayFrames(hand).at(-1)), null);
  });

  it('refuses to name a hand for a pot that cannot be awarded', () => {
    // A third player calls to the river with no cards on record. Naming a
    // winner between the two known hands would contradict the unawarded pot.
    const seats = createEmptyHand({ seatCount: 3 }).seats;
    seats[0] = { ...seats[0], name: 'Hero', cards: ['Ac', 'Kd'], isHero: true };
    seats[1] = { ...seats[1], name: 'Ada', cards: ['Qs', 'Qh'] };
    seats[2] = { ...seats[2], name: 'Ben', cards: [null, null] };

    const { valid, value: hand } = validateHandLogRequest({
      ...createEmptyHand({ seatCount: 3 }),
      name: 'Three to the river',
      seats,
      buttonSeat: 0,
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 20 },
            { seatNumber: 1, type: 'call', amount: 20 },
            { seatNumber: 2, type: 'call', amount: 20 }
          ],
          notes: ''
        },
        flop: { board: ['Kh', 'Qd', '7c'], actions: [], notes: '' },
        turn: { board: ['Ks'], actions: [], notes: '' },
        river: { board: ['2d'], actions: [], notes: '' }
      },
      result: { notes: '' }
    });
    assert.ok(valid);

    assert.deepEqual(determineWinners(hand), [], 'the pot cannot be awarded');
    assert.equal(evaluateShowdown(hand, buildReplayFrames(hand).at(-1)), null, 'so no hand is named either');
  });

  it('has nothing to show when the hand ended before the river', () => {
    const hand = allInHand({
      streets: {
        ...runOutStreets,
        river: { board: [], actions: [], notes: '' }
      }
    });
    assert.equal(evaluateShowdown(hand, buildReplayFrames(hand).at(-1)), null);
  });

  it('has nothing to show when everyone folded to one player', () => {
    const hand = allInHand({
      streets: {
        preflop: {
          board: [],
          actions: [
            { seatNumber: 0, type: 'raise', amount: 200 },
            { seatNumber: 1, type: 'fold', amount: 0 }
          ],
          notes: ''
        },
        flop: { board: ['Kh', 'Qd', '7c'], actions: [], notes: '' },
        turn: { board: ['Ks'], actions: [], notes: '' },
        river: { board: ['2d'], actions: [], notes: '' }
      }
    });
    assert.equal(evaluateShowdown(hand, buildReplayFrames(hand).at(-1)), null, 'one live seat is not a showdown');
  });
});
