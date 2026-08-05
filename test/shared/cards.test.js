/**
 * Tests for the card primitives.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOARD_SIZE,
  buildBoard,
  createDeck,
  findDuplicateCards,
  formatCards,
  isValidCard,
  normalizeCard,
  parseCards,
  removeCards
} from '../../src/shared/poker/cards.js';

describe('createDeck', () => {
  it('produces 52 distinct cards', () => {
    const deck = createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck).size, 52);
  });

  it('produces only valid cards', () => {
    assert.ok(createDeck().every(isValidCard));
  });
});

describe('normalizeCard', () => {
  it('accepts a canonical card unchanged', () => {
    assert.equal(normalizeCard('As'), 'As');
  });

  it('fixes casing in either position', () => {
    assert.equal(normalizeCard('ah'), 'Ah');
    assert.equal(normalizeCard('AH'), 'Ah');
    assert.equal(normalizeCard('  tD '), 'Td');
  });

  it('rejects nonsense', () => {
    assert.equal(normalizeCard('Zz'), null);
    assert.equal(normalizeCard('A'), null);
    assert.equal(normalizeCard(42), null);
    assert.equal(normalizeCard(null), null);
  });
});

describe('parseCards', () => {
  it('splits on whitespace and commas', () => {
    assert.deepEqual(parseCards('As Kd'), ['As', 'Kd']);
    assert.deepEqual(parseCards('as,kd'), ['As', 'Kd']);
    assert.deepEqual(parseCards('  As   Kd  '), ['As', 'Kd']);
  });

  it('drops tokens it cannot parse', () => {
    assert.deepEqual(parseCards('As zz Kd'), ['As', 'Kd']);
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(parseCards(''), []);
    assert.deepEqual(parseCards(undefined), []);
  });
});

describe('buildBoard', () => {
  it('assembles flop, turn, and river into a full board', () => {
    const board = buildBoard({ flop: ['Ah', 'Kh', 'Qh'], turn: ['Jh'], river: ['Th'] });
    assert.deepEqual(board, ['Ah', 'Kh', 'Qh', 'Jh', 'Th']);
  });

  it('accepts a bare string for single-card streets', () => {
    assert.deepEqual(buildBoard({ flop: ['Ah', 'Kh', 'Qh'], turn: 'Jh' }), ['Ah', 'Kh', 'Qh', 'Jh']);
  });

  it('skips empty streets', () => {
    assert.deepEqual(buildBoard({ flop: ['Ah', 'Kh', 'Qh'] }), ['Ah', 'Kh', 'Qh']);
    assert.deepEqual(buildBoard({}), []);
    assert.deepEqual(buildBoard(), []);
  });

  it('never exceeds a full board', () => {
    const board = buildBoard({ flop: ['Ah', 'Kh', 'Qh', 'Jh'], turn: ['Th'], river: ['9h'] });
    assert.equal(board.length, BOARD_SIZE);
  });
});

describe('findDuplicateCards', () => {
  it('finds a card reused across groups', () => {
    assert.deepEqual(findDuplicateCards(['As', 'Kd'], ['As', 'Qh']), ['As']);
  });

  it('finds a card reused within one group', () => {
    assert.deepEqual(findDuplicateCards(['As', 'As']), ['As']);
  });

  it('returns an empty array when everything is distinct', () => {
    assert.deepEqual(findDuplicateCards(['As', 'Kd'], ['Qh'], undefined), []);
  });
});

describe('removeCards', () => {
  it('removes the named cards without mutating the source', () => {
    const deck = createDeck();
    const trimmed = removeCards(deck, ['As', 'Kd']);
    assert.equal(trimmed.length, 50);
    assert.equal(deck.length, 52);
    assert.ok(!trimmed.includes('As'));
  });
});

describe('formatCards', () => {
  it('renders suits as symbols', () => {
    assert.equal(formatCards(['As', 'Kh']), 'A♠ K♥');
  });
});
