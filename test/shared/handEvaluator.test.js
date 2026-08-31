/**
 * Hand evaluation tests.
 *
 * The cases below are chosen around the places evaluators typically go wrong
 * rather than around code coverage: the wheel, the flush-and-straight overlap,
 * seven-card hands where the best five must be picked out, and split pots.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HAND_CATEGORY,
  compareCards,
  compareHands,
  describeHand,
  evaluateHand,
  findStraightHigh,
  findWinners
} from '../../src/shared/poker/handEvaluator.js';

/** @param {string[]} cards @returns {number} */
const categoryOf = cards => evaluateHand(cards).category;

describe('findStraightHigh', () => {
  it('finds a normal straight and reports its high card', () => {
    assert.equal(findStraightHigh([5, 6, 7, 8, 9]), 9);
  });

  it('finds the ace-low wheel and reports the five as high', () => {
    assert.equal(findStraightHigh([14, 2, 3, 4, 5]), 5);
  });

  it('prefers the highest straight when several are present', () => {
    assert.equal(findStraightHigh([4, 5, 6, 7, 8, 9, 10]), 10);
  });

  it('returns 0 when there is no straight', () => {
    assert.equal(findStraightHigh([2, 3, 4, 6, 7, 9, 13]), 0);
  });
});

describe('evaluateHand categories', () => {
  it('detects a straight flush', () => {
    assert.equal(categoryOf(['9h', 'Th', 'Jh', 'Qh', 'Kh', '2c', '3d']), HAND_CATEGORY.STRAIGHT_FLUSH);
  });

  it('detects four of a kind', () => {
    assert.equal(categoryOf(['As', 'Ah', 'Ad', 'Ac', 'Kh', '2c', '3d']), HAND_CATEGORY.FOUR_OF_A_KIND);
  });

  it('detects a full house', () => {
    assert.equal(categoryOf(['As', 'Ah', 'Ad', 'Kh', 'Kd', '2c', '3d']), HAND_CATEGORY.FULL_HOUSE);
  });

  it('detects a flush', () => {
    assert.equal(categoryOf(['2h', '5h', '9h', 'Jh', 'Kh', '3c', '4d']), HAND_CATEGORY.FLUSH);
  });

  it('detects a straight', () => {
    assert.equal(categoryOf(['5c', '6h', '7d', '8s', '9h', 'Kc', '2d']), HAND_CATEGORY.STRAIGHT);
  });

  it('detects the ace-low wheel as a straight', () => {
    const score = evaluateHand(['Ah', '2d', '3c', '4s', '5h', 'Kd', 'Qc']);
    assert.equal(score.category, HAND_CATEGORY.STRAIGHT);
    assert.deepEqual(score.tiebreaks, [5], 'the wheel plays as a straight to the five');
  });

  it('detects three of a kind', () => {
    assert.equal(categoryOf(['7s', '7h', '7d', 'Kh', '9d', '2c', '3s']), HAND_CATEGORY.THREE_OF_A_KIND);
  });

  it('detects two pair', () => {
    assert.equal(categoryOf(['7s', '7h', '9d', '9h', 'Kd', '2c', '3s']), HAND_CATEGORY.TWO_PAIR);
  });

  it('detects one pair', () => {
    assert.equal(categoryOf(['7s', '7h', '9d', 'Jh', 'Kd', '2c', '3s']), HAND_CATEGORY.PAIR);
  });

  it('detects high card', () => {
    assert.equal(categoryOf(['7s', '9h', 'Jd', 'Kh', '4d', '2c', '3s']), HAND_CATEGORY.HIGH_CARD);
  });
});

describe('evaluateHand edge cases', () => {
  it('does not call a flush plus an off-suit straight a straight flush', () => {
    // Hearts make a flush; 5-6-7-8-9 makes a straight across mixed suits.
    // Neither combination is a straight flush, so this must resolve to a flush.
    const score = evaluateHand(['5h', '7h', '9h', 'Jh', 'Kh', '6s', '8d']);
    assert.equal(score.category, HAND_CATEGORY.FLUSH);
  });

  it('finds a straight flush when it is genuinely in one suit', () => {
    const score = evaluateHand(['5h', '6h', '7h', '8h', '9h', 'Ks', 'Ad']);
    assert.equal(score.category, HAND_CATEGORY.STRAIGHT_FLUSH);
    assert.deepEqual(score.tiebreaks, [9]);
  });

  it('plays the lower of two trips as the pair in a full house', () => {
    const score = evaluateHand(['As', 'Ah', 'Ad', 'Ks', 'Kh', 'Kd', '2c']);
    assert.equal(score.category, HAND_CATEGORY.FULL_HOUSE);
    assert.deepEqual(score.tiebreaks, [14, 13], 'aces full of kings');
  });

  it('uses the highest pair when three pairs are available', () => {
    const score = evaluateHand(['As', 'Ah', 'Ks', 'Kh', 'Qs', 'Qh', '2c']);
    assert.equal(score.category, HAND_CATEGORY.TWO_PAIR);
    assert.deepEqual(score.tiebreaks, [14, 13, 12], 'aces and kings with a queen kicker');
  });

  it('takes the five best cards for a flush of six', () => {
    const score = evaluateHand(['2h', '5h', '9h', 'Jh', 'Kh', 'Ah', '3c']);
    assert.deepEqual(score.tiebreaks, [14, 13, 11, 9, 5]);
  });

  it('rejects fewer than five cards', () => {
    assert.throws(() => evaluateHand(['As', 'Kd', 'Qh', 'Jc']), TypeError);
  });

  it('rejects duplicate cards', () => {
    assert.throws(() => evaluateHand(['As', 'As', 'Qh', 'Jc', 'Th']), TypeError);
  });

  it('rejects malformed cards', () => {
    assert.throws(() => evaluateHand(['Xx', 'Kd', 'Qh', 'Jc', 'Th']), TypeError);
  });
});

describe('compareHands', () => {
  it('ranks a royal flush above a pair of aces', () => {
    assert.equal(
      compareCards(
        ['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2d', '3c'],
        ['As', 'Ac', '2d', '3c', '4h', '5s', '6s']
      ),
      1
    );
  });

  it('breaks a tie on kickers', () => {
    const better = evaluateHand(['As', 'Ah', 'Kd', '7c', '5h']);
    const worse = evaluateHand(['Ac', 'Ad', 'Qd', '7s', '5c']);
    assert.equal(compareHands(better, worse), 1);
  });

  it('reports an exact tie when both players play the board', () => {
    assert.equal(
      compareCards(
        ['2c', '3d', 'Ah', 'Kh', 'Qh', 'Jh', 'Th'],
        ['4c', '5d', 'Ah', 'Kh', 'Qh', 'Jh', 'Th']
      ),
      0
    );
  });
});

describe('findWinners', () => {
  it('returns a single index when one hand is best', () => {
    const scores = [
      evaluateHand(['As', 'Ah', 'Kd', '7c', '5h']),
      evaluateHand(['2s', '3h', 'Kd', '7c', '5h'])
    ];
    assert.deepEqual(findWinners(scores), [0]);
  });

  it('returns every index in a split pot', () => {
    const scores = [
      evaluateHand(['As', 'Ks', 'Qh', 'Jh', 'Th']),
      evaluateHand(['Ad', 'Kd', 'Qh', 'Jh', 'Th'])
    ];
    assert.deepEqual(findWinners(scores), [0, 1]);
  });
});

describe('describeHand', () => {
  /** @param {string[]} cards @returns {string} */
  function describe7(cards) {
    return describeHand(evaluateHand(cards));
  }

  it('names each rank in the order the hand resolves ties', () => {
    assert.equal(describe7(['Ks', 'Kd', 'Qh', 'Qc', '7s', '3d', '2c']), 'Two pair, kings and queens');
    assert.equal(describe7(['Ks', 'Kd', 'Kh', 'Qc', 'Qs', '3d', '2c']), 'Full house, kings full of queens');
    assert.equal(describe7(['6s', '6d', '6h', '6c', 'Qs', '3d', '2c']), 'Four of a kind, sixes');
    assert.equal(describe7(['Ts', 'Td', 'Th', 'Qc', '9s', '3d', '2c']), 'Three of a kind, tens');
    assert.equal(describe7(['Js', 'Jd', 'Qh', '8c', '5s', '3d', '2c']), 'Pair of jacks');
  });

  it('describes the hands that are named by their high card', () => {
    assert.equal(describe7(['Ah', '9h', '7h', '4h', '2h', 'Kd', 'Qc']), 'Flush, ace high');
    assert.equal(describe7(['9s', '8d', '7h', '6c', '5s', '2d', '2c']), 'Straight, nine high');
    assert.equal(describe7(['As', 'Kd', 'Qh', '9c', '7s', '4d', '2c']), 'Ace high');
  });

  it('reads the wheel as a five-high straight', () => {
    assert.equal(describe7(['As', '2d', '3h', '4c', '5s', 'Kd', 'Qc']), 'Straight, five high');
  });

  it('calls an ace-high straight flush a royal flush, and nothing else one', () => {
    assert.equal(describe7(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']), 'Royal flush');
    assert.equal(describe7(['Ks', 'Qs', 'Js', 'Ts', '9s', '2d', '3c']), 'Straight flush, king high');
  });
});
