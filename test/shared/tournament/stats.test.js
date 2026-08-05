/**
 * Tournament chip/money math tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activePlayerCount, averageStack, prizePool, totalChipsInPlay } from '../../../src/shared/tournament/stats.js';

const SETTINGS = { startingStack: 10000, rebuyStack: 10000, addOnStack: 15000 };
const MONEY = { buyIn: 20, rebuyAmount: 20, addOnAmount: 25 };

describe('activePlayerCount', () => {
  it('counts only players not yet eliminated', () => {
    const players = [{ eliminated: false }, { eliminated: true }, { eliminated: false }];
    assert.equal(activePlayerCount(players), 2);
  });
});

describe('totalChipsInPlay', () => {
  it('sums starting stacks with no rebuys or add-ons', () => {
    const players = [{ rebuys: 0, addOns: 0 }, { rebuys: 0, addOns: 0 }];
    assert.equal(totalChipsInPlay(players, SETTINGS), 20000);
  });

  it('adds rebuy and add-on chips', () => {
    const players = [{ rebuys: 1, addOns: 1 }, { rebuys: 0, addOns: 0 }];
    // 10000 + 10000 (rebuy) + 15000 (addon) + 10000 = 45000
    assert.equal(totalChipsInPlay(players, SETTINGS), 45000);
  });

  it("does not remove an eliminated player's chips from the total", () => {
    const players = [{ rebuys: 0, addOns: 0, eliminated: true }, { rebuys: 0, addOns: 0, eliminated: false }];
    assert.equal(totalChipsInPlay(players, SETTINGS), 20000);
  });
});

describe('averageStack', () => {
  it('divides total chips by active players', () => {
    assert.equal(averageStack(40000, 4), 10000);
  });

  it('returns 0 rather than dividing by zero when nobody is left', () => {
    assert.equal(averageStack(40000, 0), 0);
  });
});

describe('prizePool', () => {
  it('sums buy-ins', () => {
    const players = [{ rebuys: 0, addOns: 0 }, { rebuys: 0, addOns: 0 }, { rebuys: 0, addOns: 0 }];
    assert.equal(prizePool(players, MONEY), 60);
  });

  it('adds rebuy and add-on money', () => {
    const players = [{ rebuys: 2, addOns: 1 }];
    // 20 + 2*20 + 1*25 = 85
    assert.equal(prizePool(players, MONEY), 85);
  });
});
