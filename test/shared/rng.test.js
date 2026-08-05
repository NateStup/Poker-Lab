/**
 * RNG and Deck tests.
 *
 * Reproducibility is the property that matters here: if a seeded run cannot be
 * replayed, storing a seed in the history is meaningless.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Deck } from '../../src/shared/poker/deck.js';
import { Rng, hashSeed, normalizeSeed } from '../../src/shared/poker/rng.js';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());

    assert.deepEqual(first, second);
  });

  it('produces a different sequence for a different seed', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    assert.notEqual(a.next(), b.next());
  });

  it('accepts a string seed', () => {
    const a = new Rng('poker');
    const b = new Rng('poker');
    assert.equal(a.next(), b.next());
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      assert.ok(value >= 0 && value < 1, `value out of range: ${value}`);
    }
  });

  it('bounds nextInt correctly', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(52);
      assert.ok(Number.isInteger(value) && value >= 0 && value < 52);
    }
  });

  it('replays the sequence after reset', () => {
    const rng = new Rng(99);
    const first = [rng.next(), rng.next()];
    rng.reset();
    assert.deepEqual([rng.next(), rng.next()], first);
  });
});

describe('seed helpers', () => {
  it('hashes a string deterministically', () => {
    assert.equal(hashSeed('abc'), hashSeed('abc'));
    assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  });

  it('passes a numeric seed through as an unsigned 32-bit integer', () => {
    assert.equal(normalizeSeed(42), 42);
  });

  it('invents a seed when none is usable', () => {
    assert.equal(typeof normalizeSeed(undefined), 'number');
    assert.equal(typeof normalizeSeed(''), 'number');
  });
});

describe('Deck', () => {
  it('starts with a full 52 cards', () => {
    assert.equal(new Deck({ seed: 1 }).remaining, 52);
  });

  it('holds out excluded cards', () => {
    const deck = new Deck({ seed: 1, excluded: ['As', 'Kd'] });
    assert.equal(deck.remaining, 50);
    assert.ok(!deck.toArray().includes('As'));
  });

  it('shuffles identically for the same seed', () => {
    const a = new Deck({ seed: 'x' }).shuffle().toArray();
    const b = new Deck({ seed: 'x' }).shuffle().toArray();
    assert.deepEqual(a, b);
  });

  it('deals distinct cards and shrinks the deck', () => {
    const deck = new Deck({ seed: 1 }).shuffle();
    const hand = deck.deal(5);
    assert.equal(hand.length, 5);
    assert.equal(new Set(hand).size, 5);
    assert.equal(deck.remaining, 47);
  });

  it('draws distinct cards at random', () => {
    const deck = new Deck({ seed: 3 });
    const drawn = deck.drawRandom(7);
    assert.equal(new Set(drawn).size, 7);
    assert.equal(deck.remaining, 45);
  });

  it('refuses to deal more cards than remain', () => {
    const deck = new Deck({ seed: 1 });
    assert.throws(() => deck.deal(53), RangeError);
    assert.throws(() => deck.drawRandom(53), RangeError);
  });

  it('restores the full deck on reset', () => {
    const deck = new Deck({ seed: 1 });
    deck.deal(10);
    assert.equal(deck.reset().remaining, 52);
  });
});
