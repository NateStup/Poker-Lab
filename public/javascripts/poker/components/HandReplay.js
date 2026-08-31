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
import { TABLE_THEMES, getTableTheme, setTableTheme } from '../services/tableTheme.js';
import { AllInEquity } from './AllInEquity.js';
import { PlayingCard } from './PlayingCard.js';
import { PokerTable, chipSweepDurationMs } from './PokerTable.js';
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
 * Did the step from one frame to the next push the street's chips into the
 * middle?
 *
 * The dealer's sweep is the only thing that empties the felt in front of every
 * seat at once (`collectStreet` in `replay.js`, run before each new street is
 * dealt and again before the settle), so "there were chips out, and now there
 * are none" identifies it exactly, with no need to special-case which street
 * or which kind of frame is arriving.
 *
 * A sweep never changes what the hand is worth: a frame's `pot` already counts
 * chips sitting in front of seats, so it reads the same either side. What the
 * sweep changes is where those chips *are*, which is what `chipsInMiddle`
 * measures and what the felt draws.
 *
 * @param {object} before
 * @param {object} after
 * @returns {boolean}
 */
function isSweep(before, after) {
  return before.bets.some(bet => bet > 0) && after.bets.every(bet => bet === 0);
}

/**
 * What is actually stacked in the middle of the table at this frame.
 *
 * A frame's `pot` is the whole hand's wager *including* chips still sitting in
 * front of seats, which is the right number for "what is this pot worth" and
 * the wrong one for "what is in the middle" -- drawing it on the felt counted
 * every live bet twice, once in front of its player and again in the centre.
 * Subtracting the outstanding bets is the difference, and it makes the middle
 * behave the way a table does: blinds are in front of the blinds, not in the
 * pot, and a street's chips arrive in the middle only when the dealer pulls
 * them in.
 *
 * Deliberately computed here rather than added to the frame: `pot` means what
 * it means, several places rely on it, and this is a question about how the
 * felt is drawn.
 *
 * @param {object} frame
 * @returns {number}
 */
function chipsInMiddle(frame) {
  return frame.pot - frame.bets.reduce((sum, bet) => sum + bet, 0);
}

/**
 * Read at the moment of a sweep rather than subscribed to: this only decides
 * whether one animation runs, and a change part-way through a replay can wait
 * until the next step.
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Enter or leave fullscreen.
 *
 * Hidden outright where the API is unavailable rather than rendered dead.
 * `document.fullscreenEnabled` is false on iPhone Safari, which implements
 * fullscreen for `<video>` and nothing else, and a button that does nothing
 * when pressed is worse than no button at all.
 *
 * The icon is an inline SVG for the reason the back arrow and the suit pips
 * are: a glyph is one font substitution away from being a colour emoji.
 *
 * @param {object} props
 * @param {boolean} props.isFullscreen
 * @param {() => void} props.onToggle
 */
function FullscreenToggle({ isFullscreen, onToggle }) {
  if (document.fullscreenEnabled !== true) return null;

  return e(
    'button',
    {
      type: 'button',
      className: 'ghost-button hand-replay-fullscreen',
      onClick: onToggle,
      'aria-pressed': isFullscreen,
      'aria-label': isFullscreen ? 'Leave fullscreen' : 'Replay fullscreen',
      title: isFullscreen ? 'Leave fullscreen (F)' : 'Fullscreen (F)'
    },
    e(
      'svg',
      { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' },
      e('path', {
        d: isFullscreen
          ? 'M10 4v6H4M14 4v6h6M10 20v-6H4M14 20v-6h6'
          : 'M4 10V4h6M20 10V4h-6M4 14v6h6M20 14v6h-6',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        fill: 'none'
      })
    )
  );
}

/**
 * The felt picker: one swatch per theme.
 *
 * The current id is state here rather than in {@link HandReplay} because
 * nothing on the page is derived from it -- the colour reaches every table
 * through a data attribute on the document, so this component's only reason to
 * re-render is to move the ring onto the swatch that was just clicked.
 *
 * Each swatch carries its own `data-table-theme`, which is what paints it: it
 * matches the same `[data-table-theme='...']` rule the felt does, so a swatch
 * cannot advertise a colour the table will not produce. That is also why there
 * is no colour value in this file.
 */
function ThemePicker() {
  const [theme, setTheme] = React.useState(getTableTheme);

  return e(
    'div',
    { className: 'hand-replay-themes', role: 'group', 'aria-label': 'Table theme' },
    TABLE_THEMES.map(({ id, name }) =>
      e(
        'button',
        {
          key: id,
          type: 'button',
          className: `table-theme-swatch ${id === theme ? 'is-active' : ''}`,
          'data-table-theme': id,
          'aria-pressed': id === theme,
          // The preference is the viewer's, not the hand's, so it is worth
          // saying that switching here also repaints the editor's table.
          title: `${name} felt · applies to every table`,
          onClick: () => {
            setTableTheme(id);
            setTheme(id);
          }
        },
        // The swatch is a colour and nothing else, so the name is the only
        // thing a screen reader has to go on.
        e('span', { className: 'visually-hidden' }, name)
      )
    )
  );
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

  const containerRef = React.useRef(null);
  // Set only from `fullscreenchange`, never from the click handler. Escape,
  // the browser's own exit control and the element leaving the document all
  // exit fullscreen without going through anything here, so a state set
  // optimistically on click is wrong the first time anyone presses Escape.
  // The event fires for every cause, which is what makes it the only honest
  // source. Note the styling does not read this at all -- the stylesheet
  // matches `:fullscreen`, which cannot disagree with the browser even for
  // the frame before this lands. This exists to pick an icon.
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  React.useEffect(() => {
    function sync() {
      // Identity, not truthiness: another element on the page going
      // fullscreen is not this replay going fullscreen.
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // No teardown calling exitFullscreen: a fullscreen element removed from the
  // document exits fullscreen automatically, so navigating away mid-replay
  // needs nothing from here.
  //
  // Declared above the keydown effect rather than beside the other visual
  // state below, because that effect lists it as a dependency -- a dependency
  // array is evaluated during render, so a `const` declared further down would
  // still be in its temporal dead zone and throw on every render.
  const toggleFullscreen = React.useCallback(() => {
    const node = containerRef.current;
    if (!node) return;

    // Both of these return promises that reject on a request the browser
    // refuses (no user gesture, a permissions policy, an iframe without
    // `allow="fullscreen"`). Nothing is announced on a rejection because
    // nothing needs to be: no `fullscreenchange` fires, the state stays
    // false, and the button goes on offering to enter fullscreen, which is
    // an accurate description of the situation.
    if (document.fullscreenElement === node) {
      document.exitFullscreen().catch(() => {});
    } else {
      node.requestFullscreen().catch(() => {});
    }
  }, []);

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
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [frames.length, toggleFullscreen]);

  // Chips in flight: `sweep` is `{bets, from}` -- the chips travelling, and
  // the frame the table goes on showing while they travel. See `shownFrame`.
  const [sweep, setSweep] = React.useState(null);
  const previousIndex = React.useRef(index);

  // `useLayoutEffect`, emphatically not `useEffect`.
  //
  // A plain effect runs *after* the browser has painted, and by then the new
  // frame is already on screen -- the flop dealt, the pot grown. Setting the
  // sweep a moment later then rolled the table back to the previous frame for
  // the length of the animation and forward again at the end, so the flop
  // appeared, vanished and returned. That flash was the whole bug: the chips
  // were flying the entire time, underneath a table that had already shown
  // the answer and taken it away.
  //
  // A layout effect runs before paint, so the frame that would have flashed
  // is never presented at all.
  React.useLayoutEffect(() => {
    const from = previousIndex.current;
    previousIndex.current = index;

    // Only a single step forward. Scrubbing, jumping to the end, or stepping
    // back all change the table without anyone pushing chips anywhere, and
    // animating those would fire several sweeps at once on the way past.
    //
    // Clearing on the way out matters as much as setting: this effect's
    // cleanup cancels the pending timer, so a step taken *during* a sweep
    // would otherwise strand the chips on the felt with nothing left to
    // un-render them.
    if (index !== from + 1 || !isSweep(frames[from], frames[index])) {
      setSweep(null);
      return undefined;
    }

    const bets = frames[from].bets;

    // Nothing is held back for someone who has asked for less motion: the
    // sweep exists to show chips travelling, and with the travel removed all
    // that is left is a second of the table sitting on the previous frame for
    // no visible reason. They get the new frame immediately.
    if (prefersReducedMotion()) {
      setSweep(null);
      return undefined;
    }

    setSweep({ bets, from: frames[from] });

    // Un-rendering the chips is what ends the animation -- see `sweepBets` on
    // `PokerTable`. The wait comes from the same function the stagger does, so
    // the last chip is never cut off mid-flight, and it is also what holds the
    // pot at its old figure until the chips arrive.
    const timer = setTimeout(() => setSweep(null), chipSweepDurationMs(bets));
    return () => clearTimeout(timer);
  }, [index, frames]);

  // A hand swapped underneath the player leaves chips flying between two
  // tables that no longer relate to each other.
  React.useEffect(() => setSweep(null), [hand]);

  const isFirst = index === 0;
  const isLast = index === frames.length - 1;

  // What the table shows. While chips are being raked in, that is still the
  // *previous* frame -- the street that just finished, with its board and its
  // pot -- because at a real table the dealer gathers the bets first and only
  // then puts the next card out. Showing the flop at the same instant the
  // chips start moving does the two halves of that at once and reads as the
  // cards arriving before the street they belong to has been paid for.
  //
  // Only the presentation of *state* comes from here. The chips in front of
  // seats and their labels still come from `frame`, where they are already
  // cleared -- those chips are the ones in flight, so drawing them at their
  // seats as well would show every bet twice.
  const shownFrame = sweep ? sweep.from : frame;
  const streetNotes = shownFrame.kind === 'result' ? '' : hand.streets[shownFrame.street].notes;

  const runout = findAllInRunout(hand, shownFrame);
  // Once a hand is running out there is nothing left to wait for: the river
  // landing settles it, so the showdown reads there rather than one step later
  // on the settle frame. A hand still being bet only shows down at the end.
  const isRunout = isRunoutSpot(shownFrame);
  const showdown = shownFrame.kind === 'result' || isRunout ? evaluateShowdown(hand, shownFrame) : null;

  const equity = React.useMemo(() => {
    if (!runout) return null;

    const key = `${shownFrame.board.join('')}|${runout.seats.join(',')}`;
    if (!equityCache.current.has(key)) {
      equityCache.current.set(key, runoutEquity(hand, shownFrame, runout));
    }
    return equityCache.current.get(key);
    // `shownFrame` identity is stable per step, and the cache key covers
    // everything the calculation actually depends on.
  }, [hand, shownFrame, runout]);

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

  const isShowdown = shownFrame.kind === 'result'
    && shownFrame.folded.filter(hasFolded => !hasFolded).length > 1;
  const revealSeats = hand.seats.map((seat, seatIndex) =>
    seat.isHero || ((isShowdown || isRunout) && !shownFrame.folded[seatIndex]));

  return e(
    'div',
    { className: 'hand-replay', ref: containerRef },

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
              className: `hand-replay-street-pill ${shownFrame.street === street ? 'is-current' : ''} ${reached ? '' : 'is-unreached'}`
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
      winningSeats: shownFrame.kind === 'result' ? shownFrame.winningSeats : [],
      // Board and pot are held back through the sweep: the chips are gathered
      // first, then the next card comes -- and the middle's figure changes as
      // they land rather than the instant they leave, which would grow the pot
      // while the chips were still visibly in front of the players.
      board: shownFrame.board,
      pot: chipsInMiddle(shownFrame),
      // These come from the live frame, where the sweep has already emptied
      // them -- those chips are the ones in flight.
      bets: frame.bets,
      betLabels: frame.lastActions,
      stacks: frame.stacks,
      foldedSeats: frame.folded,
      actingSeat: frame.actingSeat,
      revealSeats,
      equityBySeat,
      bigBlind: hand.format.bigBlind,
      sweepBets: sweep ? sweep.bets : null
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
      }, '>|'),
      e(FullscreenToggle, { isFullscreen, onToggle: toggleFullscreen }),
      e(ThemePicker, null)
    ),

    e(
      'div',
      { className: 'hand-replay-caption' },
      // Held back with the board: announcing "the flop comes 2c 7d Kh" while
      // the felt is still gathering the last street's chips describes
      // something that has not happened yet.
      e('p', { className: 'hand-replay-headline' }, headlineFor(shownFrame, hand, positions)),
      shownFrame.kind === 'deal' && shownFrame.dealt.length > 0
        ? e('span', { className: 'playing-card-row' },
            shownFrame.dealt.map(card => e(PlayingCard, { key: card, card, size: 'sm' })))
        : null
      // No "Pot 1,200" line here any more: the felt shows the pot as chips
      // with the amount beside them, and repeating it a centimetre below was
      // the same number twice. The timeline still carries a pot per step,
      // which is for scanning the hand rather than reading this moment.
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
          e('span', { className: 'stat-label' }, `${STREET_LABELS[shownFrame.street]} notes`),
          e('p', { className: 'hand-summary-notes' }, streetNotes)
        )
      : null,

    shownFrame.kind === 'result' && hand.result.notes
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
