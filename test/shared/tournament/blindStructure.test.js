/**
 * Blind structure and clock math tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeClockState, generateBlindStructure } from '../../../src/shared/tournament/blindStructure.js';

describe('generateBlindStructure', () => {
  it('starts at 25/50 with no ante', () => {
    const [first] = generateBlindStructure();
    assert.deepEqual(first, { level: 1, smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 15 });
  });

  it('always sets the big blind to exactly double the small blind', () => {
    for (const level of generateBlindStructure({ levelCount: 20 })) {
      assert.equal(level.bigBlind, level.smallBlind * 2);
    }
  });

  it('introduces an ante starting the 4th level, equal to the small blind', () => {
    const levels = generateBlindStructure({ levelCount: 6 });
    assert.equal(levels[2].ante, 0);
    assert.equal(levels[3].ante, levels[3].smallBlind);
    assert.equal(levels[5].ante, levels[5].smallBlind);
  });

  it('increases blinds monotonically', () => {
    const levels = generateBlindStructure({ levelCount: 10 });
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i].smallBlind > levels[i - 1].smallBlind, `level ${i + 1} did not increase`);
    }
  });

  it('honours the requested level duration', () => {
    const levels = generateBlindStructure({ levelMinutes: 20, levelCount: 3 });
    assert.ok(levels.every(level => level.durationMinutes === 20));
  });

  it('clamps an absurd level count rather than throwing', () => {
    const levels = generateBlindStructure({ levelCount: 10_000 });
    assert.ok(levels.length > 0 && levels.length < 100);
  });
});

describe('computeClockState', () => {
  const structure = generateBlindStructure({ levelCount: 3, levelMinutes: 10 });

  it('reports the full level remaining when stopped', () => {
    const state = computeClockState({ structure, currentLevelIndex: 0, status: 'stopped', levelStartedAt: null, pausedElapsedMs: 0 });
    assert.equal(state.levelIndex, 0);
    assert.equal(state.remainingMs, 10 * 60_000);
    assert.equal(state.elapsedMs, 0);
    assert.equal(state.isLevelComplete, false);
  });

  it('counts down while running', () => {
    const startedAt = 1_000_000;
    const now = startedAt + 3 * 60_000; // 3 minutes into the level
    const state = computeClockState(
      { structure, currentLevelIndex: 0, status: 'running', levelStartedAt: startedAt, pausedElapsedMs: 0 },
      now
    );
    assert.equal(state.elapsedMs, 3 * 60_000);
    assert.equal(state.remainingMs, 7 * 60_000);
  });

  it('adds paused time on top of the running segment', () => {
    const startedAt = 1_000_000;
    const now = startedAt + 2 * 60_000;
    const state = computeClockState(
      { structure, currentLevelIndex: 0, status: 'running', levelStartedAt: startedAt, pausedElapsedMs: 4 * 60_000 },
      now
    );
    assert.equal(state.elapsedMs, 6 * 60_000);
  });

  it('freezes elapsed time while paused, ignoring "now"', () => {
    const state = computeClockState(
      { structure, currentLevelIndex: 0, status: 'paused', levelStartedAt: null, pausedElapsedMs: 5 * 60_000 },
      99_999_999
    );
    assert.equal(state.elapsedMs, 5 * 60_000);
  });

  it('never reports negative remaining time once the level is over', () => {
    const startedAt = 0;
    const now = 999 * 60_000;
    const state = computeClockState(
      { structure, currentLevelIndex: 0, status: 'running', levelStartedAt: startedAt, pausedElapsedMs: 0 },
      now
    );
    assert.equal(state.remainingMs, 0);
    assert.equal(state.isLevelComplete, true);
  });

  it('flags the final level and exposes the next one otherwise', () => {
    const mid = computeClockState({ structure, currentLevelIndex: 0, status: 'stopped', levelStartedAt: null, pausedElapsedMs: 0 });
    assert.equal(mid.isFinalLevel, false);
    assert.deepEqual(mid.nextLevel, structure[1]);

    const last = computeClockState({ structure, currentLevelIndex: structure.length - 1, status: 'stopped', levelStartedAt: null, pausedElapsedMs: 0 });
    assert.equal(last.isFinalLevel, true);
    assert.equal(last.nextLevel, null);
  });

  it('clamps an out-of-range level index rather than throwing', () => {
    const state = computeClockState({ structure, currentLevelIndex: 999, status: 'stopped', levelStartedAt: null, pausedElapsedMs: 0 });
    assert.equal(state.levelIndex, structure.length - 1);
  });
});
