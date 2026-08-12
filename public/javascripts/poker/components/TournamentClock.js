/**
 * The blind timer: current level, a big countdown, and the controls to run
 * it. The countdown itself is computed by the caller (via the shared
 * `computeClockState`, re-run every second against the record's raw
 * `levelStartedAt` timestamp) -- this component only renders whatever it's
 * handed, so the same clock math the server uses for `derived.clock` is
 * exactly what ticks on screen between server syncs.
 */

import { describeLevel } from './TournamentStatus.js';

const e = React.createElement;

/** @param {number} ms @returns {string} `'MM:SS'`, floored to the second */
function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * @param {object} props
 * @param {'setup'|'active'|'completed'} props.status tournament status
 * @param {'running'|'paused'} props.clockStatus
 * @param {object} props.liveClock a `computeClockState` result
 * @param {(action: string) => void} props.onAction
 */
export function TournamentClock({ status, clockStatus, liveClock, onAction }) {
  const { level, nextLevel, remainingMs, isFinalLevel } = liveClock;

  return e(
    'div',
    { className: 'tournament-clock' },
    e('div', { className: 'tournament-clock-level' }, `Level ${level.level}${isFinalLevel ? ' (final)' : ''}`),
    e('div', { className: 'tournament-clock-time' }, formatClock(remainingMs)),
    e('div', { className: 'tournament-clock-blinds' }, describeLevel(level)),
    nextLevel
      ? e('div', { className: 'footnote' }, `Next: ${describeLevel(nextLevel)}`)
      : e('div', { className: 'footnote' }, 'Final level -- no further increases.'),
    status === 'completed'
      ? e('p', { className: 'footnote' }, 'The tournament is complete.')
      : e(
          'div',
          { className: 'tournament-clock-actions' },
          status === 'setup'
            ? e('button', { type: 'button', onClick: () => onAction('start') }, 'Start clock')
            : clockStatus === 'running'
              ? e('button', { type: 'button', onClick: () => onAction('pause') }, 'Pause')
              : e('button', { type: 'button', onClick: () => onAction('resume') }, 'Resume'),
          e('button', {
            type: 'button',
            className: 'ghost-button',
            disabled: status === 'setup' || isFinalLevel,
            onClick: () => onAction('advance')
          }, 'Skip to next level')
        )
  );
}
