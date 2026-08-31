/**
 * A tournament's status, said usefully.
 *
 * "Active" is technically the record's state and practically useless to
 * someone glancing at a list or a header -- the question being asked is always
 * *what level is it on and what are the blinds*. That is what this renders,
 * with the bare state (paused, complete, not started) folded in as the part
 * that qualifies it rather than the part that leads.
 *
 * Both the list rows and the open tournament's header use it, so the two can't
 * describe the same tournament differently. `describeLevel` is exported for
 * `TournamentClock`, which shows the same blinds under its countdown.
 */

const e = React.createElement;

/**
 * @param {{smallBlind: number, bigBlind: number, ante: number}} level
 * @returns {string} `'25/50'`, or `'25/50 (ante 25)'` when there is an ante
 */
export function describeLevel(level) {
  const blinds = `${level.smallBlind.toLocaleString()}/${level.bigBlind.toLocaleString()}`;
  return level.ante > 0 ? `${blinds} (ante ${level.ante.toLocaleString()})` : blinds;
}

/**
 * @param {object} props
 * @param {'setup'|'active'|'completed'} props.status
 * @param {'running'|'paused'} props.clockStatus
 * @param {{level: number, smallBlind: number, bigBlind: number, ante: number}} props.level
 *   the current level, from `computeClockState`
 * @param {boolean} [props.isFinalLevel]
 */
export function TournamentStatus({ status, clockStatus, level, isFinalLevel = false }) {
  const blinds = describeLevel(level);

  let tone = 'is-live';
  let text;
  if (status === 'setup') {
    // Before the clock starts there is no "current" level in any meaningful
    // sense, so this says what the first one *will* be rather than implying
    // the tournament is sitting on level 1 already.
    tone = 'is-setup';
    text = `Not started · opens at ${blinds}`;
  } else if (status === 'completed') {
    tone = 'is-done';
    text = `Complete · ended on level ${level.level} (${blinds})`;
  } else if (clockStatus === 'paused') {
    tone = 'is-paused';
    text = `Paused · level ${level.level} · ${blinds}`;
  } else {
    text = `Level ${level.level}${isFinalLevel ? ' (final)' : ''} · ${blinds}`;
  }

  return e(
    'span',
    { className: `tournament-status ${tone}` },
    e('span', { className: 'tournament-status-dot', 'aria-hidden': 'true' }),
    text
  );
}
