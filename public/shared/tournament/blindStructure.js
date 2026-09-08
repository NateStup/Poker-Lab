/**
 * Blind structure generation and clock math for the tournament manager.
 *
 * Pure and isomorphic like `shared/poker/` -- the server validates and stores
 * a structure, the browser renders the countdown from the exact same clock
 * math, so there is never a discrepancy between what the organizer's screen
 * and a spectator's screen say the clock reads.
 */

/**
 * "Nice" chip denominations a blind level would actually use at a table --
 * generating levels from this ladder rather than a raw multiplier avoids
 * suggesting an odd blind like 137/274.
 */
const BLIND_LADDER = Object.freeze([
  25, 50, 75, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000,
  4000, 5000, 6000, 8000, 10000, 15000, 20000, 25000, 30000, 40000, 50000,
  60000, 80000, 100000
]);

/** Levels before antes start being suggested (index, not level number). */
const ANTE_START_INDEX = 3;

/**
 * Suggest a blind structure. This is a starting point the organizer is
 * expected to edit, not a solved schedule -- there's no "correct" tournament
 * length, only a reasonable default.
 *
 * @param {object} [options]
 * @param {number} [options.levelCount=16] how many levels to generate
 * @param {number} [options.levelMinutes=15] duration of every level
 * @returns {Array<{level: number, smallBlind: number, bigBlind: number, ante: number, durationMinutes: number}>}
 */
export function generateBlindStructure({ levelCount = 16, levelMinutes = 15 } = {}) {
  const count = Math.max(1, Math.min(levelCount, BLIND_LADDER.length));
  const levels = [];

  for (let i = 0; i < count; i++) {
    const smallBlind = BLIND_LADDER[i];
    levels.push({
      level: i + 1,
      smallBlind,
      bigBlind: smallBlind * 2,
      // A simple, common house rule: once the ante kicks in, it equals the
      // small blind. The organizer can retune any level after generation.
      ante: i >= ANTE_START_INDEX ? smallBlind : 0,
      durationMinutes: levelMinutes
    });
  }

  return levels;
}

/**
 * @typedef {object} ClockRecord
 * @property {Array<{durationMinutes: number}>} structure the blind levels
 * @property {number} currentLevelIndex
 * @property {'stopped'|'running'|'paused'} status
 * @property {number|null} levelStartedAt epoch ms; `null` unless `status === 'running'`
 * @property {number} pausedElapsedMs time already accumulated in the current
 *   level before its most recent pause; reset to 0 whenever the level changes
 */

/**
 * Derive the clock's current reading. Pure function of the stored clock state
 * and a timestamp -- never reads the real clock itself -- so it is exactly
 * reproducible in a test and identical whether computed on the server or in
 * the browser.
 *
 * @param {ClockRecord} clock
 * @param {number} [now] epoch ms; defaults to the real current time
 * @returns {{
 *   levelIndex: number,
 *   level: {level: number, smallBlind: number, bigBlind: number, ante: number, durationMinutes: number},
 *   nextLevel: object|null,
 *   elapsedMs: number,
 *   remainingMs: number,
 *   isFinalLevel: boolean,
 *   isLevelComplete: boolean
 * }}
 */
export function computeClockState(clock, now = Date.now()) {
  const { structure, currentLevelIndex, status, levelStartedAt, pausedElapsedMs } = clock;
  const levelIndex = Math.max(0, Math.min(currentLevelIndex, structure.length - 1));
  const level = structure[levelIndex];

  const runningMs = status === 'running' && levelStartedAt !== null ? Math.max(0, now - levelStartedAt) : 0;
  const elapsedMs = pausedElapsedMs + runningMs;
  const levelDurationMs = level.durationMinutes * 60000;
  const remainingMs = Math.max(0, levelDurationMs - elapsedMs);

  return {
    levelIndex,
    level,
    nextLevel: structure[levelIndex + 1] || null,
    elapsedMs,
    remainingMs,
    isFinalLevel: levelIndex === structure.length - 1,
    isLevelComplete: remainingMs <= 0
  };
}
