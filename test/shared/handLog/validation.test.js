/**
 * Hand-log validation tests.
 *
 * The line this file is really defending: impossible *data* is rejected
 * (a turn with no flop, one card used twice, no hero), while merely odd
 * *poker* is accepted (betting after a fold, a wild overbet) -- this is a
 * logger, and a hand that reads strangely is usually a hand that was played
 * strangely.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEmptyHand, validateHandLogRequest } from '../../../src/shared/handLog/validation.js';

/** @param {object} [overrides] @returns {object} a payload that should validate */
function validPayload(overrides = {}) {
  return { ...createEmptyHand({ seatCount: 6 }), name: 'Cooler on the river', ...overrides };
}

describe('validateHandLogRequest', () => {
  it('accepts and normalises a complete hand', () => {
    const { valid, errors, value } = validateHandLogRequest(validPayload({
      seats: createEmptyHand({ seatCount: 6 }).seats.map((seat, index) =>
        index === 0 ? { ...seat, cards: ['ah', 'KS'] } : seat),
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 0, type: 'raise', amount: 6 }], notes: 'opened from the button' },
        flop: { board: ['2c', '7d', 'ts'], actions: [{ seatNumber: 0, type: 'bet', amount: 8 }], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));

    assert.ok(valid, errors.join(' '));
    assert.deepEqual(value.seats[0].cards, ['Ah', 'Ks'], 'cards are normalised to canonical form');
    assert.deepEqual(value.streets.flop.board, ['2c', '7d', 'Ts']);
    assert.equal(value.streets.preflop.notes, 'opened from the button');
  });

  it('requires a name', () => {
    const { valid, errors } = validateHandLogRequest(validPayload({ name: '   ' }));
    assert.equal(valid, false);
    assert.ok(errors.some(error => error.includes('`name`')));
  });

  it('requires exactly one hero', () => {
    const seats = createEmptyHand({ seatCount: 6 }).seats.map(seat => ({ ...seat, isHero: false }));
    const noHero = validateHandLogRequest(validPayload({ seats }));
    assert.equal(noHero.valid, false);
    assert.ok(noHero.errors.some(error => error.includes('hero')));

    seats[0].isHero = true;
    seats[1].isHero = true;
    const twoHeroes = validateHandLogRequest(validPayload({ seats }));
    assert.equal(twoHeroes.valid, false);
  });

  it('rejects a table that is too small or too large', () => {
    assert.equal(validateHandLogRequest(validPayload({ seats: createEmptyHand({ seatCount: 2 }).seats.slice(0, 1) })).valid, false);
    const tooMany = createEmptyHand({ seatCount: 10 }).seats.concat(createEmptyHand({ seatCount: 2 }).seats);
    assert.equal(validateHandLogRequest(validPayload({ seats: tooMany })).valid, false);
  });

  it('rejects a partially dealt street', () => {
    const { valid, errors } = validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: { board: ['As', 'Kd'], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.equal(valid, false);
    assert.ok(errors.some(error => error.includes('flop')), errors.join(' '));
  });

  it('treats a board of empty slots as not dealt', () => {
    // The editor hands back fixed-size arrays with `null` holes, so a flop
    // whose slots were opened and then cleared arrives as three nulls -- that
    // is "no flop", not a malformed one.
    const { valid, value } = validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: { board: [null, null, null], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.ok(valid);
    assert.deepEqual(value.streets.flop.board, []);
  });

  it('rejects a flop with a gap in it', () => {
    const { valid, errors } = validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: { board: ['As', null, '7h'], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.equal(valid, false, 'two of three cards is not a flop');
    assert.ok(errors.some(error => error.includes('flop')), errors.join(' '));
  });

  it('rejects a street dealt out of order', () => {
    const { valid, errors } = validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: ['As'], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.equal(valid, false);
    assert.ok(errors.some(error => error.includes('cannot be dealt before')), errors.join(' '));
  });

  it('rejects the same card appearing twice', () => {
    const seats = createEmptyHand({ seatCount: 6 }).seats.map((seat, index) =>
      index === 0 ? { ...seat, cards: ['As', 'Kd'] } : seat);

    const { valid, errors } = validateHandLogRequest(validPayload({
      seats,
      streets: {
        preflop: { board: [], actions: [], notes: '' },
        flop: { board: ['As', '7c', '2h'], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.equal(valid, false);
    assert.ok(errors.some(error => error.includes('As')), errors.join(' '));
  });

  it('allows a half-known hand: one hole card seen, one not', () => {
    const seats = createEmptyHand({ seatCount: 6 }).seats.map((seat, index) =>
      index === 1 ? { ...seat, cards: ['As', null] } : seat);

    const { valid, value } = validateHandLogRequest(validPayload({ seats }));
    assert.ok(valid, 'a villain who only showed one card is a normal thing to log');
    assert.deepEqual(value.seats[1].cards, ['As', null]);
  });

  it('rejects a bet with no amount but accepts a check with none', () => {
    const withBadBet = validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 0, type: 'bet' }], notes: '' },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.equal(withBadBet.valid, false);

    const withCheck = validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 0, type: 'check' }], notes: '' },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.ok(withCheck.valid);
    assert.equal(withCheck.value.streets.preflop.actions[0].amount, 0);
  });

  it('rejects an action referring to a seat that does not exist', () => {
    assert.equal(validateHandLogRequest(validPayload({
      streets: {
        preflop: { board: [], actions: [{ seatNumber: 99, type: 'fold' }], notes: '' },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    })).valid, false);
  });

  it('rejects a button or straddle seat that is off the table', () => {
    assert.equal(validateHandLogRequest(validPayload({ buttonSeat: 6 })).valid, false);
    assert.equal(validateHandLogRequest(validPayload({
      format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: 9, straddleAmount: 4 }
    })).valid, false);
  });

  it('requires a straddle amount when a straddle seat is named', () => {
    const { valid, errors } = validateHandLogRequest(validPayload({
      format: { gameType: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, straddleSeat: 3, straddleAmount: 0 }
    }));
    assert.equal(valid, false);
    assert.ok(errors.some(error => error.includes('straddleAmount')), errors.join(' '));
  });

  it('keeps the result to notes, ignoring a winner sent by an older client', () => {
    // Who won is derived from the hand now (`determineWinners`). A stored
    // record written before that change still has `winningSeats` in it, so it
    // has to load rather than fail validation on the way back in.
    const { valid, value } = validateHandLogRequest(validPayload({
      result: { winningSeats: [2, 3], notes: 'ran good' }
    }));

    assert.ok(valid);
    assert.equal(value.result.notes, 'ran good');
    assert.ok(!('winningSeats' in value.result), 'the winner is not stored');
  });

  it('accepts poker that is odd but not impossible', () => {
    // Betting after folding is not something to reject: it is far more
    // likely a user logging from memory than a claim about the rules.
    const { valid } = validateHandLogRequest(validPayload({
      streets: {
        preflop: {
          board: [],
          actions: [{ seatNumber: 4, type: 'fold' }, { seatNumber: 4, type: 'raise', amount: 500 }],
          notes: ''
        },
        flop: { board: [], actions: [], notes: '' },
        turn: { board: [], actions: [], notes: '' },
        river: { board: [], actions: [], notes: '' }
      }
    }));
    assert.ok(valid);
  });
});

describe('createEmptyHand', () => {
  it('produces a hand that already validates apart from its name', () => {
    const empty = createEmptyHand();
    assert.equal(validateHandLogRequest(empty).valid, false, 'a nameless hand is not saveable');
    assert.ok(validateHandLogRequest({ ...empty, name: 'Untitled' }).valid);
  });

  it('marks the first seat as the hero and gives every seat two card slots', () => {
    const empty = createEmptyHand({ seatCount: 9 });
    assert.equal(empty.seats.length, 9);
    assert.equal(empty.seats.filter(seat => seat.isHero).length, 1);
    assert.ok(empty.seats.every(seat => seat.cards.length === 2 && seat.cards.every(card => card === null)));
  });
});
