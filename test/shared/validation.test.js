/**
 * Request-validation tests.
 *
 * The contract these lock in is that validation reports *all* problems at once
 * and returns a normalised value, so callers never re-parse the raw payload.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateEquityRequest, validateRangeEquityRequest } from '../../src/shared/poker/validation.js';

describe('validateEquityRequest', () => {
  it('accepts a minimal valid request', () => {
    const { valid, value } = validateEquityRequest({
      players: [['As', 'Ah'], ['Kd', 'Kc']]
    });

    assert.equal(valid, true);
    assert.deepEqual(value.players, [['As', 'Ah'], ['Kd', 'Kc']]);
    assert.deepEqual(value.board, []);
    assert.deepEqual(value.dead, []);
  });

  it('normalises loose casing', () => {
    const { valid, value } = validateEquityRequest({
      players: [['as', 'AH'], ['kd', 'kc']],
      board: ['2C', '7d', '9H']
    });

    assert.equal(valid, true);
    assert.deepEqual(value.players[0], ['As', 'Ah']);
    assert.deepEqual(value.board, ['2c', '7d', '9h']);
  });

  it('rejects a missing players array', () => {
    const { valid, errors } = validateEquityRequest({});
    assert.equal(valid, false);
    assert.match(errors[0], /players/);
  });

  it('rejects a hand without exactly two cards', () => {
    const { valid, errors } = validateEquityRequest({
      players: [['As'], ['Kd', 'Kc']]
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /Player 1/.test(error)));
  });

  it('rejects a card used twice', () => {
    const { valid, errors } = validateEquityRequest({
      players: [['As', 'Ah'], ['As', 'Kc']]
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /only be used once/.test(error)));
  });

  it('rejects a card shared between a hand and the board', () => {
    const { valid, errors } = validateEquityRequest({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      board: ['As', '7d', '9h']
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /As/.test(error)));
  });

  it('rejects a board that is not at a street boundary', () => {
    const { valid, errors } = validateEquityRequest({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      board: ['2c', '7d']
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /0, 3, 4, or 5/.test(error)));
  });

  it('accepts every legal board size', () => {
    const boards = [[], ['2c', '7d', '9h'], ['2c', '7d', '9h', 'Ts'], ['2c', '7d', '9h', 'Ts', '3s']];

    for (const board of boards) {
      const { valid } = validateEquityRequest({ players: [['As', 'Ah'], ['Kd', 'Kc']], board });
      assert.equal(valid, true, `board of ${board.length} should be valid`);
    }
  });

  it('rejects an out-of-range iteration count', () => {
    const { valid, errors } = validateEquityRequest({
      players: [['As', 'Ah'], ['Kd', 'Kc']],
      iterations: 99_999_999
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /iterations/.test(error)));
  });

  it('rejects a table that is too small or too large', () => {
    assert.equal(validateEquityRequest({ players: [['As', 'Ah']] }).valid, false);

    const tooMany = Array.from({ length: 11 }, () => ['As', 'Ah']);
    assert.equal(validateEquityRequest({ players: tooMany }).valid, false);
  });

  it('collects several problems in one pass', () => {
    const { valid, errors } = validateEquityRequest({
      players: [['As'], ['Kd', 'Kc']],
      board: ['2c', '7d'],
      iterations: -5
    });

    assert.equal(valid, false);
    assert.ok(errors.length >= 3, `expected several errors, got ${errors.length}`);
  });
});

describe('validateRangeEquityRequest', () => {
  it('accepts a hero range against a specific villain hand', () => {
    const { valid, value } = validateRangeEquityRequest({
      heroRange: ['AA', 'AKs'],
      villain: { cards: ['kd', 'kc'] }
    });

    assert.equal(valid, true);
    assert.deepEqual(value.heroRange, ['AA', 'AKs']);
    assert.deepEqual(value.villain, { cards: ['Kd', 'Kc'] });
    assert.deepEqual(value.board, []);
  });

  it('accepts a hero range against a villain range', () => {
    const { valid, value } = validateRangeEquityRequest({
      heroRange: ['AA'],
      villain: { hands: ['KK', 'QQ'] }
    });

    assert.equal(valid, true);
    assert.deepEqual(value.villain, { hands: ['KK', 'QQ'] });
  });

  it('rejects a missing or empty hero range', () => {
    const { valid, errors } = validateRangeEquityRequest({ villain: { cards: ['Kd', 'Kc'] } });
    assert.equal(valid, false);
    assert.ok(errors.some(error => /heroRange/.test(error)));

    assert.equal(
      validateRangeEquityRequest({ heroRange: [], villain: { cards: ['Kd', 'Kc'] } }).valid,
      false
    );
  });

  it('rejects a hero range with an invalid hand code', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['AA', 'not-a-hand'],
      villain: { cards: ['Kd', 'Kc'] }
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /invalid hand codes/.test(error)));
  });

  it('rejects a non-canonical hand code (wrong rank order)', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['KAs'],
      villain: { cards: ['Kd', 'Kc'] }
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /invalid hand codes/.test(error)));
  });

  it('rejects a missing villain', () => {
    const { valid, errors } = validateRangeEquityRequest({ heroRange: ['AA'] });
    assert.equal(valid, false);
    assert.ok(errors.some(error => /villain/.test(error)));
  });

  it('rejects villain.cards without exactly two cards', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['AA'],
      villain: { cards: ['Kd'] }
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /villain\.cards/.test(error)));
  });

  it('rejects villain.hands with an invalid hand code', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['AA'],
      villain: { hands: ['zz'] }
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /villain\.hands/.test(error)));
  });

  it('rejects a villain card shared with the board', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['AA'],
      villain: { cards: ['Kd', 'Kc'] },
      board: ['Kd', '7d', '9h']
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /only be used once/.test(error)));
  });

  it('rejects a board that is not at a street boundary', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['AA'],
      villain: { cards: ['Kd', 'Kc'] },
      board: ['2c', '7d']
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /0, 3, 4, or 5/.test(error)));
  });

  it('rejects an out-of-range iteration count', () => {
    const { valid, errors } = validateRangeEquityRequest({
      heroRange: ['AA'],
      villain: { cards: ['Kd', 'Kc'] },
      iterations: 99_999_999
    });

    assert.equal(valid, false);
    assert.ok(errors.some(error => /iterations/.test(error)));
  });
});
