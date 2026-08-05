/**
 * Outs calculator tests.
 *
 * Every assertion here is provable by hand -- outs are counted exactly by
 * enumeration, so there's no sampling noise to allow for and no excuse for a
 * wide band. Each scenario is picked so the exact winning cards can be listed
 * by a human, not just the count.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateOuts } from '../../src/shared/poker/outs.js';

describe('calculateOuts', () => {
  it('counts a flush draw plus overcard outs on the flop', () => {
    // Hero: Ah Kh on 2h 7h 9c, vs villain's pocket queens.
    // Any of the 9 remaining hearts makes hero's flush (which beats a pair,
    // and still beats trip queens if the heart happens to be Qh). Any
    // non-heart ace or king pairs hero above villain's queens. Nothing else
    // changes the outcome with just one card.
    const result = calculateOuts({
      players: [['Ah', 'Kh'], ['Qs', 'Qc']],
      board: ['2h', '7h', '9c']
    });

    assert.equal(result.unseenCount, 45);

    const hero = result.players[0];
    const expectedWins = ['Qh', 'Jh', 'Th', '9h', '8h', '6h', '5h', '4h', '3h', 'As', 'Ad', 'Ac', 'Ks', 'Kd', 'Kc'];
    assert.deepEqual(hero.winCards.slice().sort(), expectedWins.slice().sort());
    assert.equal(hero.winOuts, 15);
    assert.equal(hero.tieOuts, 0);
    assert.equal(hero.outs, 15);
    assert.equal(hero.percent, 15 / 45);

    const villain = result.players[1];
    assert.equal(villain.winOuts, 45 - 15);
  });

  it('gives an already-made quad hand every remaining card as a win, on the turn', () => {
    // Hero already holds quad sevens (7c7d in hand, 7h7s on board); nothing
    // villain can pair on a single card beats four of a kind.
    const result = calculateOuts({
      players: [['7c', '7d'], ['As', 'Ks']],
      board: ['7h', '7s', '2c', '9d']
    });

    assert.equal(result.unseenCount, 44);
    assert.equal(result.players[0].winOuts, 44);
    assert.equal(result.players[0].tieOuts, 0);
    assert.equal(result.players[1].winOuts, 0);
  });

  it('requires exactly two players', () => {
    assert.throws(
      () => calculateOuts({ players: [['As', 'Ah']], board: ['2c', '7d', '9h'] }),
      TypeError
    );
    assert.throws(
      () => calculateOuts({ players: [['As', 'Ah'], ['Kd', 'Kc'], ['Qs', 'Qh']], board: ['2c', '7d', '9h'] }),
      TypeError
    );
  });

  it('requires a flop or turn board, not preflop or a complete board', () => {
    assert.throws(() => calculateOuts({ players: [['As', 'Ah'], ['Kd', 'Kc']], board: [] }), TypeError);
    assert.throws(
      () => calculateOuts({ players: [['As', 'Ah'], ['Kd', 'Kc']], board: ['2c', '7d', '9h', 'Ts', '3s'] }),
      TypeError
    );
  });
});
