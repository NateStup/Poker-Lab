/**
 * The table diagram: seats arranged around a racetrack felt.
 *
 * Seats are positioned with geometry into `left`/`top` percentages rather than
 * drawn with SVG or a canvas -- each seat stays a real DOM button, so it is
 * focusable, clickable and screen-reader-navigable for free, which a painted
 * canvas would have to reimplement.
 *
 * The outline is a **stadium** (two semicircular ends joined by straights),
 * not an ellipse: that is the shape a real poker table is, and an ellipse put
 * the middle seats visibly off the felt edge because its sides curve away
 * where a table's are straight. Seats are spaced by *arc length* along that
 * outline rather than by angle, which is what keeps the gap between
 * neighbours even -- angle-stepping bunches seats up at the ends.
 *
 * The one thing to keep in sync: the felt's box and the seat ring are both
 * derived from the same `TABLE_SHAPE` entry, and the container's aspect ratio
 * is set inline from it too. The geometry can't be split between here and the
 * stylesheet without the seats drifting off the felt the first time either
 * side is edited.
 *
 * Purely presentational: it renders whatever it is handed and reports clicks
 * upward. Position labels are passed in (derived once by the page from
 * `derivePositions`) rather than computed here, so the diagram and the rest of
 * the page can never disagree about who is on the button.
 */

import { ChipStack } from './ChipStack.js';
import { TableLogo } from './Logo.js';
import { PlayingCard } from './PlayingCard.js';

const e = React.createElement;

/**
 * Table proportions, in units of the container's *width* (so `halfHeight` is
 * comparable with `halfWidth` regardless of the aspect ratio).
 *
 * Narrow screens get a round table rather than a squashed one: with the ring
 * as wide as it is tall the stadium degenerates to a circle, which the same
 * arc-length maths handles with no special case, and ten seats down the sides
 * of a phone-width oval would overlap anyway.
 */
const TABLE_SHAPE = Object.freeze({
  wide: Object.freeze({ aspect: 16 / 9, halfWidth: 0.435, halfHeight: 0.235, feltInset: 0.055 }),
  narrow: Object.freeze({ aspect: 1, halfWidth: 0.4, halfHeight: 0.4, feltInset: 0.075 })
});

/** How far in from a seat, toward the middle, its bet sits (0 = felt centre). */
const BET_RING_SCALE = 0.56;

/**
 * How long a chip takes to travel from a seat to the middle.
 *
 * Exported because the caller has to un-render the flying chips when they
 * arrive, and a duration defined once here but timed out separately there is
 * two numbers free to drift. The stylesheet gets it too -- inline, off this
 * constant -- so all three agree by construction rather than by upkeep.
 */
export const CHIP_SWEEP_MS = 950;

/**
 * Stagger between one seat's chips leaving and the next's. Kept well under
 * the flight time so the chips overlap into one movement -- spaced far enough
 * apart to queue up, a ten-handed pot takes several seconds to gather.
 */
const CHIP_SWEEP_STAGGER_MS = 70;

/**
 * Where swept chips come to rest: the pot, not the centre of the felt.
 *
 * Measured rather than assumed. `.poker-table-middle` stacks the board above
 * the pot, which puts the pot below centre (58.8% of the table's height on the
 * wide layout, 56.5% on the narrow one) and the board above it at ~44%.
 * Landing chips at a flat 50% ran them straight across the community cards --
 * cluttered, and the wrong story besides: chips go to the pot, not to the
 * board. One figure covers both layouts closely enough, and it still points
 * somewhere sensible when no pot is drawn yet, since an empty middle renders
 * nothing but the chips still need a destination.
 */
const CHIP_SWEEP_TARGET = Object.freeze({ left: '50%', top: '58%' });

/**
 * Chip-label wording per action type.
 *
 * `post` is deliberately absent: a blind or an ante needs no caption, because
 * chips sitting in front of a seat that hasn't acted are self-evidently a
 * forced bet. Labelling them added a word to every seat on every preflop
 * frame and buried the labels that mean something.
 */
const ACTION_LABELS = Object.freeze({
  fold: 'Folds',
  check: 'Checks',
  call: 'Calls',
  bet: 'Bets',
  raise: 'Raises to'
});

/**
 * A point on the stadium outline, `t` of the way around it.
 *
 * The walk starts at the bottom centre -- where the viewer sits at a real
 * table -- and runs clockwise from there, matching the seat order the rest of
 * the app uses. Requires `halfWidth >= halfHeight`; the cap radius is the
 * shorter half-axis, and the two of them being equal is just a circle.
 *
 * @param {number} t position around the outline, 0 to 1
 * @param {number} halfWidth half the outline's width, in container-width units
 * @param {number} halfHeight half its height, same units
 * @returns {{x: number, y: number}} offset from the centre, same units, y downward
 */
function stadiumPoint(t, halfWidth, halfHeight) {
  const radius = halfHeight;
  const straight = halfWidth - halfHeight;
  const cap = Math.PI * radius;
  let distance = t * (4 * straight + 2 * cap);

  // 1. bottom edge, centre to the left corner
  if (distance < straight) return { x: -distance, y: radius };
  distance -= straight;

  // 2. left cap, sweeping from the bottom of the arc round to the top
  if (distance < cap) {
    const angle = Math.PI / 2 + distance / radius;
    return { x: -straight + radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }
  distance -= cap;

  // 3. top edge, left corner to right corner
  if (distance < 2 * straight) return { x: -straight + distance, y: -radius };
  distance -= 2 * straight;

  // 4. right cap, top of the arc round to the bottom
  if (distance < cap) {
    const angle = -Math.PI / 2 + distance / radius;
    return { x: straight + radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }
  distance -= cap;

  // 5. bottom edge, right corner back to the centre
  return { x: straight - distance, y: radius };
}

/**
 * Turn an offset in container-width units into CSS percentages. Vertical
 * percentages are relative to the container's *height*, so the aspect ratio
 * has to come back in here or everything vertical lands at the wrong place.
 * @param {{x: number, y: number}} point
 * @param {number} aspect the container's width / height
 * @returns {{left: string, top: string}}
 */
function toCss({ x, y }, aspect) {
  return { left: `${50 + x * 100}%`, top: `${50 + y * aspect * 100}%` };
}

/**
 * Track a media query as React state, so the seat geometry and the container's
 * aspect ratio change together on a resize. A CSS-only breakpoint would move
 * the felt without moving the seats.
 * @param {string} query
 * @returns {boolean}
 */
function useMediaQuery(query) {
  const [matches, setMatches] = React.useState(() => window.matchMedia(query).matches);

  React.useEffect(() => {
    const list = window.matchMedia(query);
    const update = event => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * @param {{type: string, amount: number}} label
 * @returns {string|null} null for an action that speaks for itself
 */
function betLabelText({ type, amount }) {
  const verb = ACTION_LABELS[type];
  if (!verb) return null;
  return amount > 0 ? `${verb} ${amount.toLocaleString()}` : verb;
}

/**
 * @param {object} props
 * @param {object[]} props.seats
 * @param {number} props.buttonSeat
 * @param {string[]} props.positions position label per seat, from `derivePositions`
 * @param {number} [props.pot] shown in the middle of the felt when provided
 * @param {number[]} [props.winningSeats]
 * @param {number|null} [props.selectedSeat]
 * @param {(seatNumber: number) => void} [props.onSelectSeat] omit for a read-only diagram
 * @param {string[]} [props.board] community cards shown on the felt
 * @param {number[]} [props.bets] chips currently in front of each seat (replay)
 * @param {Array<{type: string, amount: number}|null>} [props.betLabels] what each seat just did
 * @param {number[]} [props.stacks] stack to show per seat; defaults to the seat's starting stack
 * @param {boolean[]} [props.foldedSeats] seats that are out of the hand
 * @param {number|null} [props.actingSeat] the seat being highlighted right now
 * @param {boolean[]|null} [props.revealSeats] which seats show their cards face-up;
 *   omit to show every card that is known (the editor and the write-up both
 *   want that -- only a replay hides a holding that wasn't visible yet)
 * @param {Record<number, number>|null} [props.equityBySeat] win share per seat,
 *   0 to 1, shown beside that seat's cards during an all-in run-out
 * @param {number} [props.bigBlind] the hand's big blind, which is the unit a
 *   wager's chip stack is sized in; omit and every wager draws a single chip
 * @param {number[]|null} [props.sweepBets] chips currently in flight from each
 *   seat to the middle. Purely a visual: the caller decides a sweep happened
 *   and clears this after `CHIP_SWEEP_MS`, because *when* chips move is a fact
 *   about stepping through a replay, which this diagram knows nothing about.
 *   What it does own is *where* they move, which is why the animation is here
 *   next to the geometry rather than in the player.
 */
export function PokerTable({
  seats,
  buttonSeat,
  positions,
  pot,
  winningSeats = [],
  selectedSeat = null,
  onSelectSeat,
  board = [],
  bets = [],
  betLabels = [],
  stacks = null,
  foldedSeats = [],
  actingSeat = null,
  revealSeats = null,
  equityBySeat = null,
  bigBlind = 0,
  sweepBets = null
}) {
  const isInteractive = typeof onSelectSeat === 'function';
  const isNarrow = useMediaQuery('(max-width: 640px)');
  const shape = isNarrow ? TABLE_SHAPE.narrow : TABLE_SHAPE.wide;

  const feltWidth = (shape.halfWidth - shape.feltInset) * 2;
  const feltHeight = (shape.halfHeight - shape.feltInset) * 2;

  return e(
    'div',
    { className: 'poker-table', style: { aspectRatio: String(shape.aspect) } },
    e(
      'div',
      {
        className: 'poker-table-rail',
        style: {
          left: `${(50 - (feltWidth / 2) * 100)}%`,
          top: `${(50 - (feltHeight / 2) * shape.aspect * 100)}%`,
          width: `${feltWidth * 100}%`,
          height: `${feltHeight * shape.aspect * 100}%`
        }
      },
      e(
        'div',
        { className: 'poker-table-felt' },
        // Stitched into the felt, behind everything: decorative, and the board
        // and pot render on top of it.
        e(TableLogo),
        e(
          'div',
          { className: 'poker-table-middle' },
          e(
            'div',
            { className: 'poker-table-board' },
            board.map((card, index) => e(PlayingCard, { key: `${card}-${index}`, card, size: 'md' }))
          ),
          // Chips, not the word "Pot". What is in the middle of a table is a
          // pile of chips with an amount -- the label was naming something
          // the picture already says. Nothing is drawn at zero, because an
          // empty middle is empty, not a stack worth no chips.
          //
          // `ChipStack` is `aria-hidden` (it is a drawing), so the word has to
          // survive for a screen reader even though it is gone from the felt.
          pot !== undefined && pot > 0
            ? e(
                'div',
                {
                  className: `poker-table-pot ${sweepBets ? 'is-collecting' : ''}`,
                  // The *whole* sweep, stagger included, so the nudge lands
                  // with the last chip and the figure changing -- not with
                  // the first one, which arrives well before the pot is right.
                  style: sweepBets ? { animationDuration: `${chipSweepDurationMs(sweepBets)}ms` } : undefined
                },
                e(ChipStack, { amount: pot, bigBlind }),
                e('strong', null,
                  e('span', { className: 'visually-hidden' }, 'Pot: '),
                  pot.toLocaleString())
              )
            : null
        )
      )
    ),

    seats.map((seat, index) => {
      const isWinner = winningSeats.includes(seat.seatNumber);
      const hasFolded = foldedSeats[index] === true;
      const classNames = [
        'poker-table-seat',
        seat.isHero ? 'is-hero' : '',
        index === buttonSeat ? 'is-button' : '',
        selectedSeat === index ? 'is-selected' : '',
        isWinner ? 'is-winner' : '',
        hasFolded ? 'is-folded' : '',
        actingSeat === index ? 'is-acting' : ''
      ].filter(Boolean).join(' ');

      const cards = revealSeats && revealSeats[index] !== true ? [] : seat.cards.filter(Boolean);
      const stack = stacks ? stacks[index] : seat.stack;
      const bet = bets[index] || 0;
      const label = betLabels[index] || null;
      const labelText = label ? betLabelText(label) : null;

      return e(
        React.Fragment,
        { key: seat.seatNumber },

        e(
          isInteractive ? 'button' : 'div',
          {
            className: classNames,
            style: toCss(stadiumPoint(index / seats.length, shape.halfWidth, shape.halfHeight), shape.aspect),
            ...(isInteractive
              ? { type: 'button', onClick: () => onSelectSeat(index), 'aria-pressed': selectedSeat === index }
              : {}),
            title: isInteractive ? `Edit ${seat.name}` : undefined
          },
          e(
            'div',
            { className: 'poker-table-seat-head' },
            e('span', { className: 'poker-table-position' }, positions[index]),
            index === buttonSeat ? e('span', { className: 'poker-table-button-chip', title: 'Dealer button' }, 'D') : null
          ),
          e('span', { className: 'poker-table-seat-name' }, seat.name),
          e('span', { className: 'poker-table-seat-stack footnote' }, stack.toLocaleString()),
          e(
            'div',
            { className: 'poker-table-seat-cards' },
            cards.length > 0
              ? cards.map(card => e(PlayingCard, { key: card, card, size: 'sm', isDimmed: hasFolded }))
              : isInteractive
                ? e('span', { className: 'preview-placeholder' }, 'add cards')
                // A read-only table shows backs rather than a dash: an unknown
                // holding is exactly what a face-down card means.
                : [0, 1].map(slot => e(PlayingCard, { key: slot, card: null, size: 'sm', isDimmed: hasFolded })),
            // Beside the cards, not under the seat: at an all-in the equity
            // belongs to the hand being looked at.
            equityBySeat && equityBySeat[index] !== undefined
              ? e('span', { className: 'poker-table-equity' }, `${Math.round(equityBySeat[index] * 100)}%`)
              : null
          )
        ),

        // The chips a seat has out, sitting between them and the middle -- the
        // separate element (rather than a line inside the seat box) is what
        // makes a bet read as chips on the felt.
        labelText || bet > 0
          ? e(
              'div',
              {
                className: `poker-table-bet ${bet > 0 ? 'has-chips' : ''} ${hasFolded ? 'is-folded' : ''}`,
                style: toCss(
                  scalePoint(stadiumPoint(index / seats.length, shape.halfWidth, shape.halfHeight), BET_RING_SCALE),
                  shape.aspect
                )
              },
              labelText ? e('span', { className: 'poker-table-bet-action' }, labelText) : null,
              bet > 0
                ? e(
                    'span',
                    { className: 'poker-table-bet-chips' },
                    e(ChipStack, { amount: bet, bigBlind }),
                    e('strong', null, bet.toLocaleString())
                  )
                : null
            )
          : null
      );
    }),

    // Chips in flight. These start where that seat's bet was sitting and are
    // animated to the felt's centre by the stylesheet; they exist only while
    // the caller says a sweep is happening, so mounting them *is* the trigger
    // and there is no animation to restart or reset. Decorative throughout --
    // every number they represent is already on the felt somewhere.
    // The stagger counts seats that actually have chips, not seat numbers: a
    // lone bet from seat 9 should leave immediately, not sit still for nine
    // seats' worth of delay first. `chipSweepDurationMs` counts the same way.
    movingBets(sweepBets).map(({ amount, index, ordinal }) => {
      const from = toCss(
        scalePoint(stadiumPoint(index / seats.length, shape.halfWidth, shape.halfHeight), BET_RING_SCALE),
        shape.aspect
      );

      // Deliberately the *same* element a bet is drawn with, plus a modifier.
      // A flying chip that had its own box could position differently from the
      // bet it replaces, and the illusion depends entirely on it starting in
      // exactly the place the bet just was.
      return e(
        'div',
        {
          key: index,
          className: 'poker-table-bet has-chips is-sweeping',
          'aria-hidden': 'true',
          style: {
            ...from,
            // The keyframes name both ends explicitly and read the start from
            // here. Leaving the start implicit -- animating only `to` and
            // letting the browser infer `from` off the inline style -- is
            // legal but leaves the most important half of the movement to
            // resolution rules that are easy to get subtly wrong.
            '--sweep-from-left': from.left,
            '--sweep-from-top': from.top,
            '--sweep-to-left': CHIP_SWEEP_TARGET.left,
            '--sweep-to-top': CHIP_SWEEP_TARGET.top,
            animationDuration: `${CHIP_SWEEP_MS}ms`,
            animationDelay: `${ordinal * CHIP_SWEEP_STAGGER_MS}ms`
          }
        },
        // Chips only, no amount. The figure was already on the felt a moment
        // ago as the bet, it is about to be on the felt again as the pot, and
        // in between it is four small numbers sliding across the community
        // cards. The chips alone carry the movement.
        e(
          'span',
          { className: 'poker-table-bet-chips' },
          e(ChipStack, { amount, bigBlind })
        )
      );
    })
  );
}

/**
 * The seats with chips to sweep, tagged with their place in the queue.
 * @param {number[]|null} bets
 * @returns {Array<{amount: number, index: number, ordinal: number}>}
 */
function movingBets(bets) {
  if (!bets) return [];
  return bets
    .map((amount, index) => ({ amount, index }))
    .filter(entry => entry.amount > 0)
    .map((entry, ordinal) => ({ ...entry, ordinal }));
}

/**
 * How long a whole sweep takes, last chip included -- what the caller waits
 * before clearing `sweepBets`. Reads the stagger the same way the render
 * does, so a chip can't be un-rendered mid-flight.
 *
 * @param {number[]|null} bets
 * @returns {number} milliseconds
 */
export function chipSweepDurationMs(bets) {
  return CHIP_SWEEP_MS + Math.max(0, movingBets(bets).length - 1) * CHIP_SWEEP_STAGGER_MS;
}

/**
 * Move a point toward the centre of the table.
 * @param {{x: number, y: number}} point
 * @param {number} scale
 * @returns {{x: number, y: number}}
 */
function scalePoint({ x, y }, scale) {
  return { x: x * scale, y: y * scale };
}
