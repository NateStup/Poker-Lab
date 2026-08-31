/**
 * The full hand editor: format, seats, four streets, and the result.
 *
 * Used for both "log a new hand" and "edit a saved one" -- an edit is just
 * this form opened over an existing record, which is why it takes an
 * `initialValue` rather than building an empty hand itself.
 *
 * Seats are edited through the table diagram: click a seat, and an editor for
 * that one seat appears beneath it. That keeps ten seats' worth of fields off
 * the screen at once while leaving the table -- the thing that tells you at a
 * glance who is where -- always visible.
 */

import {
  DEFAULT_STARTING_STACK,
  STREET_NAMES,
  computeHandDerived,
  createEmptyHand,
  derivePositions
} from '/shared/handLog/index.js';
import { CardSlot } from './CardSlot.js';
import { HandStreetEditor } from './HandStreetEditor.js';
import { PokerTable } from './PokerTable.js';

const e = React.createElement;

const SEAT_COUNT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Every card assigned anywhere in the hand -- hole cards and all four
 * streets -- so no picker can offer a card that is already in use.
 * @param {object} hand
 * @returns {string[]}
 */
function allUsedCards(hand) {
  return [
    ...hand.seats.flatMap(seat => seat.cards.filter(Boolean)),
    ...dealtBoard(hand)
  ];
}

/**
 * The community cards actually chosen so far. Boards carry `null` holes while
 * being edited, so anything rendering or comparing them has to drop those.
 * @param {object} hand
 * @returns {string[]}
 */
function dealtBoard(hand) {
  return STREET_NAMES.flatMap(street => hand.streets[street].board.filter(Boolean));
}

/**
 * Grow or shrink the roster, keeping the seats that survive.
 * @param {object[]} seats
 * @param {number} seatCount
 * @param {number} startingStack what a seat added by this resize starts with
 * @returns {object[]}
 */
function resizeSeats(seats, seatCount, startingStack) {
  const template = createEmptyHand({ seatCount, startingStack }).seats;
  const resized = template.map((blank, index) => (seats[index] ? { ...seats[index], seatNumber: index } : blank));

  // Shrinking the table can remove the hero's seat, which would leave a hand
  // that can't be saved. Falling back to seat 0 is less surprising than a
  // validation error the user can't see the cause of.
  if (!resized.some(seat => seat.isHero)) resized[0] = { ...resized[0], isHero: true };
  return resized;
}

/**
 * @param {object} props
 * @param {object} props.initialValue a hand record (or `createEmptyHand()`)
 * @param {string} props.submitLabel
 * @param {(hand: object) => Promise<void>} props.onSubmit
 * @param {() => void} props.onCancel
 */
export function HandBuilderForm({ initialValue, submitLabel, onSubmit, onCancel }) {
  const [hand, setHand] = React.useState(initialValue);
  const [selectedSeat, setSelectedSeat] = React.useState(null);
  const [openSlot, setOpenSlot] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // The base stack is a control, not part of the record: the hand stores what
  // each seat actually had, and a second copy of "what they all started with"
  // would be one more thing able to disagree with the seats themselves. It is
  // seeded from the hand being edited so reopening one doesn't reset it, and
  // it is what a seat added by growing the table starts with.
  const [startingStack, setStartingStack] = React.useState(
    () => initialValue.seats[0]?.stack ?? DEFAULT_STARTING_STACK
  );

  const positions = derivePositions(hand.seats.length, hand.buttonSeat);
  const usedCards = allUsedCards(hand);
  // A live pot preview, computed with the same function the server uses --
  // there is no second implementation to drift, so what the form shows while
  // typing is exactly what the saved hand will report.
  const derived = computeHandDerived(hand);

  function patch(changes) {
    setHand(current => ({ ...current, ...changes }));
  }

  function patchFormat(changes) {
    setHand(current => ({ ...current, format: { ...current.format, ...changes } }));
  }

  function patchSeat(index, changes) {
    setHand(current => ({
      ...current,
      seats: current.seats.map((seat, i) => (i === index ? { ...seat, ...changes } : seat))
    }));
  }

  /**
   * Set every seat's stack at once. Individual seats can still be edited
   * afterwards on the felt -- this is the starting point, not a lock.
   * @param {number} stack
   */
  function setStartingStackForAll(stack) {
    setStartingStack(stack);
    setHand(current => ({ ...current, seats: current.seats.map(seat => ({ ...seat, stack })) }));
  }

  function setSeatCount(seatCount) {
    setHand(current => {
      const seats = resizeSeats(current.seats, seatCount, startingStack);
      return {
        ...current,
        seats,
        buttonSeat: Math.min(current.buttonSeat, seatCount - 1),
        // Seats that no longer exist can't stay referenced by the straddle or
        // the result, or the hand becomes unsaveable for a reason that isn't
        // visible anywhere on screen.
        format: {
          ...current.format,
          straddleSeat: current.format.straddleSeat !== null && current.format.straddleSeat < seatCount
            ? current.format.straddleSeat
            : null
        },
        streets: Object.fromEntries(STREET_NAMES.map(street => [
          street,
          { ...current.streets[street], actions: current.streets[street].actions.filter(action => action.seatNumber < seatCount) }
        ]))
      };
    });
    setSelectedSeat(null);
  }

  function toggleHero(index) {
    setHand(current => ({
      ...current,
      seats: current.seats.map((seat, i) => ({ ...seat, isHero: i === index }))
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(hand);
    } catch (err) {
      setError({ message: err.message, details: err.details });
    } finally {
      setIsSubmitting(false);
    }
  }

  const seat = selectedSeat === null ? null : hand.seats[selectedSeat];

  return e(
    'form',
    { className: 'card-form hand-builder', onSubmit: handleSubmit },

    e(
      'div',
      { className: 'field-row' },
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-name' }, 'Hand name'),
        e('input', {
          id: 'hand-name',
          type: 'text',
          value: hand.name,
          placeholder: 'e.g. Set over set on the turn',
          maxLength: 120,
          onChange: event => patch({ name: event.target.value })
        })
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-game-type' }, 'Game'),
        e(
          'select',
          {
            id: 'hand-game-type',
            value: hand.format.gameType,
            onChange: event => patchFormat({ gameType: event.target.value })
          },
          e('option', { value: 'cash' }, 'Cash game'),
          e('option', { value: 'tournament' }, 'Tournament')
        )
      )
    ),

    e(
      'div',
      { className: 'field-row' },
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-sb' }, 'Small blind'),
        e('input', {
          id: 'hand-sb', type: 'number', min: 0, step: 'any',
          value: hand.format.smallBlind,
          onChange: event => patchFormat({ smallBlind: Number(event.target.value) })
        })
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-bb' }, 'Big blind'),
        e('input', {
          id: 'hand-bb', type: 'number', min: 0, step: 'any',
          value: hand.format.bigBlind,
          onChange: event => patchFormat({ bigBlind: Number(event.target.value) })
        })
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-ante' }, 'Ante (each)'),
        e('input', {
          id: 'hand-ante', type: 'number', min: 0, step: 'any',
          value: hand.format.ante,
          onChange: event => patchFormat({ ante: Number(event.target.value) })
        })
      )
    ),

    e(
      'div',
      { className: 'field-row' },
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-seat-count' }, 'Seats'),
        e(
          'select',
          {
            id: 'hand-seat-count',
            value: hand.seats.length,
            onChange: event => setSeatCount(Number(event.target.value))
          },
          SEAT_COUNT_OPTIONS.map(count => e('option', { key: count, value: count }, `${count}-handed`))
        )
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-starting-stack' }, 'Starting stacks'),
        e('input', {
          id: 'hand-starting-stack',
          type: 'number',
          min: 0,
          step: 'any',
          value: startingStack,
          onChange: event => setStartingStackForAll(Number(event.target.value))
        }),
        e('span', { className: 'footnote' }, 'Sets every seat; edit one on the felt to differ.')
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-button-seat' }, 'Button'),
        e(
          'select',
          {
            id: 'hand-button-seat',
            value: hand.buttonSeat,
            onChange: event => patch({ buttonSeat: Number(event.target.value) })
          },
          hand.seats.map(entry => e('option', { key: entry.seatNumber, value: entry.seatNumber }, entry.name))
        )
      ),
      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'hand-straddle' }, 'Straddle'),
        e(
          'select',
          {
            id: 'hand-straddle',
            value: hand.format.straddleSeat === null ? '' : hand.format.straddleSeat,
            onChange: event => patchFormat({
              straddleSeat: event.target.value === '' ? null : Number(event.target.value),
              straddleAmount: event.target.value === '' ? 0 : hand.format.straddleAmount || hand.format.bigBlind * 2
            })
          },
          e('option', { value: '' }, 'None'),
          hand.seats.map(entry => e('option', { key: entry.seatNumber, value: entry.seatNumber }, entry.name))
        )
      ),
      hand.format.straddleSeat !== null
        ? e(
            'div',
            { className: 'field-group' },
            e('label', { htmlFor: 'hand-straddle-amount' }, 'Straddle amount'),
            e('input', {
              id: 'hand-straddle-amount', type: 'number', min: 1, step: 'any',
              value: hand.format.straddleAmount,
              onChange: event => patchFormat({ straddleAmount: Number(event.target.value) })
            })
          )
        : null
    ),

    e(
      'div',
      { className: 'range-panel' },
      e(
        'div',
        { className: 'range-panel-head' },
        e('h2', null, 'Table'),
        e('span', { className: 'footnote' }, 'Click a seat to name it, set its stack, or give it cards.')
      ),
      e(PokerTable, {
        seats: hand.seats,
        buttonSeat: hand.buttonSeat,
        positions,
        pot: derived.totalPot,
        winningSeats: derived.winningSeats,
        selectedSeat,
        onSelectSeat: index => setSelectedSeat(selectedSeat === index ? null : index),
        board: dealtBoard(hand),
        bigBlind: hand.format.bigBlind
      }),

      seat
        ? e(
            'div',
            { className: 'hand-seat-editor' },
            e(
              'div',
              { className: 'range-panel-head' },
              e('h3', null, `${positions[selectedSeat]} · ${seat.name}`),
              e('button', {
                type: 'button',
                className: 'ghost-button',
                onClick: () => setSelectedSeat(null)
              }, 'Done')
            ),
            e(
              'div',
              { className: 'field-row' },
              e(
                'div',
                { className: 'field-group' },
                e('label', { htmlFor: 'seat-name' }, 'Name'),
                e('input', {
                  id: 'seat-name', type: 'text', value: seat.name, maxLength: 40,
                  onChange: event => patchSeat(selectedSeat, { name: event.target.value })
                })
              ),
              e(
                'div',
                { className: 'field-group' },
                e('label', { htmlFor: 'seat-stack' }, 'Starting stack'),
                e('input', {
                  id: 'seat-stack', type: 'number', min: 0, step: 'any', value: seat.stack,
                  onChange: event => patchSeat(selectedSeat, { stack: Number(event.target.value) })
                })
              )
            ),
            e(
              'div',
              { className: 'hand-seat-editor-row' },
              e(
                'div',
                { className: 'card-slot-row' },
                seat.cards.map((card, cardIndex) => {
                  const slotId = `seat-${selectedSeat}-${cardIndex}`;
                  return e(CardSlot, {
                    key: slotId,
                    card,
                    usedCards: usedCards.filter(used => used !== card),
                    isOpen: openSlot === slotId,
                    onToggleOpen: () => setOpenSlot(openSlot === slotId ? null : slotId),
                    onClose: () => setOpenSlot(null),
                    onPick: picked => patchSeat(selectedSeat, {
                      cards: seat.cards.map((existing, i) => (i === cardIndex ? picked : existing))
                    }),
                    label: `${seat.name} card ${cardIndex + 1}`
                  });
                })
              ),
              e(
                'label',
                { className: 'hand-hero-toggle' },
                e('input', {
                  type: 'radio',
                  name: 'hero-seat',
                  checked: seat.isHero,
                  onChange: () => toggleHero(selectedSeat)
                }),
                ' This is me (hero)'
              )
            )
          )
        : null
    ),

    e(
      'div',
      { className: 'hand-streets' },
      STREET_NAMES.map(street =>
        e(HandStreetEditor, {
          key: street,
          street,
          value: hand.streets[street],
          // The editor prices this street's action against everything
          // committed before it, so it needs the whole hand, not just its own
          // street.
          hand,
          seats: hand.seats,
          positions,
          usedCards,
          openSlot,
          onOpenSlot: setOpenSlot,
          onChange: next => setHand(current => ({ ...current, streets: { ...current.streets, [street]: next } }))
        })
      )
    ),

    // No winner picker: who takes the pot is read off the hand as it is typed
    // (see `determineWinners`). This panel reports that reading back, and says
    // what is missing when the hand doesn't yet answer the question -- which
    // is the only thing the user can usefully do about it.
    e(
      'div',
      { className: 'range-panel' },
      e(
        'div',
        { className: 'range-panel-head' },
        e('h2', null, 'Outcome'),
        e('span', { className: 'footnote' }, `Pot ${derived.totalPot.toLocaleString()}`)
      ),
      derived.payouts.length > 0
        ? e(
            'p',
            { className: 'hand-outcome' },
            derived.payouts.map(payout =>
              `${hand.seats[payout.seatNumber].name} wins ${payout.amount.toLocaleString()}`).join(' · ')
          )
        : e(
            'p',
            { className: 'footnote' },
            'Nobody has the pot yet. It goes to the last player left when everyone else folds, '
            + 'or to the best hand once the board is complete and every player still in has both cards logged.'
          ),
      e('textarea', {
        className: 'hand-notes',
        rows: 2,
        placeholder: 'Any read or lesson worth keeping?',
        value: hand.result.notes,
        maxLength: 2000,
        onChange: event => patch({ result: { ...hand.result, notes: event.target.value } }),
        'aria-label': 'Hand notes'
      })
    ),

    error
      ? e(
          'div',
          { className: 'error-card' },
          e('p', null, error.message),
          error.details && error.details.length > 0
            ? e('ul', { className: 'error-details' }, error.details.map(detail => e('li', { key: detail }, detail)))
            : null
        )
      : null,

    e(
      'div',
      { className: 'form-actions' },
      e('button', { type: 'submit', disabled: isSubmitting }, isSubmitting ? 'Saving...' : submitLabel),
      e('button', { type: 'button', className: 'ghost-button', onClick: onCancel }, 'Cancel')
    )
  );
}
