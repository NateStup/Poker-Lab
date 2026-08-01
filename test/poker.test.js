const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHand, buildBoard, compareHandRankings } = require('../lib/poker');

test('royal flush beats a pair of aces', () => {
  const royalFlush = ['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2d', '3c'];
  const pairOfAces = ['As', 'Ac', '2d', '3c', '4h', '5s', '6s'];

  assert.equal(compareHandRankings(evaluateHand(royalFlush), evaluateHand(pairOfAces)), 1);
});

test('buildBoard keeps a full five-card board when flop, turn, and river are supplied', () => {
  const board = buildBoard({ flop: ['Ah', 'Kh', 'Qh'], turn: ['Jh'], river: ['Th'] });
  assert.deepEqual(board, ['Ah', 'Kh', 'Qh', 'Jh', 'Th']);
});
