/**
 * The hand replayer: step through a logged hand one beat at a time.
 *
 * This is the point of sharing a hand. A link that only shows the finished
 * numbers hands someone a conclusion; a link that replays the action lets them
 * see the spot the way the player saw it -- who was left, what the stacks
 * were, what the pot laid before each decision.
 *
 * All the arithmetic comes from `buildReplayFrames` in the shared domain, so
 * the walk is the same one the tests cover and the same betting rules the
 * server totals a hand with. Everything here is presentation: choosing a frame
 * and wording it.
 */

import {
  STREET_NAMES,
  buildReplayFrames,
  evaluateShowdown,
  findAllInRunout,
  isRunoutSpot,
  runoutEquity
} from '/shared/handLog/index.js';
import { AllInEquity } from './AllInEquity.js';
import { PlayingCard } from './PlayingCard.js';
import { PokerTable } from './PokerTable.js';
import { ShowdownResult } from './ShowdownResult.js';

const e = React.createElement;

const STREET_LABELS = Object.freeze({ preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' });

/** Third-person wording for the headline, e.g. "Ada raises to 300". */
const ACTION_VERBS = Object.freeze({
  fold: 'folds',
  check: 'checks',
  call: 'calls',
  bet: 'bets',
  raise: 'raises to'
});

/** @param {number} amount @returns {string} */
function formatChips(amount) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * One line describing what just happened, which is what makes the replay
 * followable without reading the table on every step.
 *
 * @param {object} frame from `buildReplayFrames`
 * @param {object} hand the hand being replayed
 * @param {string[]} positions
 * @returns {string}
 */
function headlineFor(frame, hand, positions) {
  const name = seatNumber => hand.seats[seatNumber].name;

  if (frame.kind === 'deal') {
    if (frame.street === 'preflop') {
      const posted = frame.bets.reduce((sum, bet) => sum + bet, 0);
      return posted > 0 ? `Cards in the air — ${formatChips(posted)} posted` : 'Cards in the air';
    }
    return `The ${STREET_LABELS[frame.street].toLowerCase()} comes ${frame.dealt.join(' ')}`;
  }

  if (frame.kind === 'action') {
    const { seatNumber, type, amount } = frame.action;
    const verb = ACTION_VERBS[type] || type;
    const suffix = amount > 0 ? ` ${formatChips(amount)}` : '';
    return `${name(seatNumber)} (${positions[seatNumber]}) ${verb}${suffix}`;
  }

  if (frame.payouts.length === 0) return 'Hand over — no winner recorded';
  if (frame.payouts.length === 1) {
    return `${name(frame.payouts[0].seatNumber)} wins ${formatChips(frame.payouts[0].amount)}`;
  }
  return `Chopped: ${frame.payouts.map(payout => `${name(payout.seatNumber)} ${formatChips(payout.amount)}`).join(', ')}`;
}

/**
 * @param {object} props
 * @param {object} props.hand a hand record (`derived` is not required -- the
 *   replay recomputes what it needs from the raw hand)
 * @param {string[]} props.positions position label per seat
 */
export function HandReplay({ hand, positions }) {
  const frames = React.useMemo(() => buildReplayFrames(hand), [hand]);
  const [step, setStep] = React.useState(0);

  // Equity is the one expensive thing on this page (a preflop all-in samples
  // thousands of runouts), and stepping back and forth revisits the same
  // boards over and over -- so results are cached by the spot they describe
  // rather than recomputed per render. Cleared whenever the hand changes.
  const equityCache = React.useRef(new Map());
  React.useEffect(() => { equityCache.current = new Map(); }, [hand]);

  // A hand edited underneath the player can be shorter than the step we were
  // on; clamping on render beats letting the component index past the end.
  const index = Math.min(step, frames.length - 1);
  const frame = frames[index];

  const goTo = React.useCallback(
    next => setStep(Math.max(0, Math.min(frames.length - 1, next))),
    [frames.length]
  );

  React.useEffect(() => {
    function handleKeyDown(event) {
      // Arrow keys belong to whatever the user is typing in, if anything.
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setStep(current => Math.min(frames.length - 1, current + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setStep(current => Math.max(0, current - 1));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [frames.length]);

  const isFirst = index === 0;
  const isLast = index === frames.length - 1;
  const streetNotes = frame.kind === 'result' ? '' : hand.streets[frame.street].notes;

  const runout = findAllInRunout(hand, frame);
  // Once a hand is running out there is nothing left to wait for: the river
  // landing settles it, so the showdown reads there rather than one step later
  // on the settle frame. A hand still being bet only shows down at the end.
  const isRunout = isRunoutSpot(frame);
  const showdown = frame.kind === 'result' || isRunout ? evaluateShowdown(hand, frame) : null;

  const equity = React.useMemo(() => {
    if (!runout) return null;

    const key = `${frame.board.join('')}|${runout.seats.join(',')}`;
    if (!equityCache.current.has(key)) {
      equityCache.current.set(key, runoutEquity(hand, frame, runout));
    }
    return equityCache.current.get(key);
    // `frame` identity is stable per step, and the cache key covers everything
    // the calculation actually depends on.
  }, [hand, frame, runout]);

  // Hero's cards are face-up throughout -- a replay is watched from the
  // hero's seat, and hiding what they were holding would make their decisions
  // unreadable. Everyone else stays face-down until their cards became public
  // at the table: at showdown, or the moment the last bet went in on an all-in
  // that still has cards to come, which is when a real table turns them over.
  // A hand that ended with everyone folding never reaches either, so nothing
  // is revealed -- the villain mucked, and the log knowing their cards doesn't
  // change that they were never seen.
  // Equity reads beside each hand on the felt as well as in the panel below:
  // during a run-out that is the number being watched, and it belongs next to
  // the cards it is about.
  const equityBySeat = equity
    ? Object.fromEntries(equity.seats.map(seat => [seat.seatNumber, seat.equity]))
    : null;

  const isShowdown = frame.kind === 'result' && frame.folded.filter(hasFolded => !hasFolded).length > 1;
  const revealSeats = hand.seats.map((seat, seatIndex) =>
    seat.isHero || ((isShowdown || isRunout) && !frame.folded[seatIndex]));

  return e(
    'div',
    { className: 'hand-replay' },

    e(
      'div',
      { className: 'hand-replay-head' },
      e(
        'div',
        { className: 'hand-replay-street' },
        STREET_NAMES.map(street => {
          const reached = frames.some(candidate => candidate.street === street);
          return e(
            'span',
            {
              key: street,
              className: `hand-replay-street-pill ${frame.street === street ? 'is-current' : ''} ${reached ? '' : 'is-unreached'}`
            },
            STREET_LABELS[street]
          );
        })
      ),
      e('span', { className: 'footnote' }, `Step ${index + 1} of ${frames.length}`)
    ),

    e(PokerTable, {
      seats: hand.seats,
      buttonSeat: hand.buttonSeat,
      positions,
      pot: frame.pot,
      winningSeats: frame.kind === 'result' ? frame.winningSeats : [],
      board: frame.board,
      bets: frame.bets,
      betLabels: frame.lastActions,
      stacks: frame.stacks,
      foldedSeats: frame.folded,
      actingSeat: frame.actingSeat,
      revealSeats,
      equityBySeat,
      bigBlind: hand.format.bigBlind
    }),

    e(
      'div',
      { className: 'hand-replay-controls' },
      e('button', {
        type: 'button', className: 'ghost-button', onClick: () => goTo(0), disabled: isFirst,
        'aria-label': 'Back to the start'
      }, '|<'),
      e('button', {
        type: 'button', className: 'ghost-button', onClick: () => goTo(index - 1), disabled: isFirst,
        'aria-label': 'Previous step'
      }, '< Back'),
      e('input', {
        type: 'range',
        className: 'hand-replay-scrubber',
        min: 0,
        max: frames.length - 1,
        value: index,
        onChange: event => goTo(Number(event.target.value)),
        'aria-label': 'Step through the hand'
      }),
      e('button', {
        type: 'button', onClick: () => goTo(index + 1), disabled: isLast,
        'aria-label': 'Next step'
      }, 'Next >'),
      e('button', {
        type: 'button', className: 'ghost-button', onClick: () => goTo(frames.length - 1), disabled: isLast,
        'aria-label': 'Jump to the end'
      }, '>|')
    ),

    e(
      'div',
      { className: 'hand-replay-caption' },
      e('p', { className: 'hand-replay-headline' }, headlineFor(frame, hand, positions)),
      frame.kind === 'deal' && frame.dealt.length > 0
        ? e('span', { className: 'playing-card-row' },
            frame.dealt.map(card => e(PlayingCard, { key: card, card, size: 'sm' })))
        : null,
      e('span', { className: 'footnote' }, `Pot ${formatChips(frame.pot)}`)
    ),

    equity
      ? e(AllInEquity, { seats: hand.seats, positions, equity, cardsToCome: runout.cardsToCome })
      : null,

    showdown
      ? e(ShowdownResult, { seats: hand.seats, positions, showdown })
      : null,

    streetNotes
      ? e(
          'div',
          { className: 'hand-replay-notes' },
          e('span', { className: 'stat-label' }, `${STREET_LABELS[frame.street]} notes`),
          e('p', { className: 'hand-summary-notes' }, streetNotes)
        )
      : null,

    frame.kind === 'result' && hand.result.notes
      ? e(
          'div',
          { className: 'hand-replay-notes' },
          e('span', { className: 'stat-label' }, 'Result notes'),
          e('p', { className: 'hand-summary-notes' }, hand.result.notes)
        )
      : null,

    // The whole timeline, with the current beat marked. Clicking a row jumps
    // there, which is how anyone analysing a hand actually navigates it --
    // "show me that turn bet again" rather than pressing back four times.
    e(
      'ol',
      { className: 'hand-replay-timeline' },
      frames.map(candidate =>
        e(
          'li',
          { key: candidate.index },
          e(
            'button',
            {
              type: 'button',
              className: `hand-replay-step ${candidate.index === index ? 'is-current' : ''} ${candidate.kind !== 'action' ? 'is-marker' : ''}`,
              onClick: () => goTo(candidate.index),
              'aria-current': candidate.index === index ? 'step' : undefined
            },
            e('span', { className: 'hand-action-seat' }, STREET_LABELS[candidate.street]),
            e('span', { className: 'hand-action-name' }, headlineFor(candidate, hand, positions)),
            e('span', { className: 'footnote' }, formatChips(candidate.pot))
          )
        )
      )
    )
  );
}
