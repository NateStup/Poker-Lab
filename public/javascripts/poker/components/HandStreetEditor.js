/**
 * One street of a hand: its board cards, its betting actions, and its notes.
 *
 * The action entry form deliberately reads "seat / action / to amount" in that
 * order, matching how a hand is spoken aloud ("the button raises to twelve").
 * The amount is a street *total*, not an increment -- see the note in
 * `shared/handLog/actions.js`; the input label says "to" for exactly that
 * reason, because the difference is invisible otherwise and gets the pot wrong.
 */

import { ACTION_TYPES, ACTION_TYPES_WITH_AMOUNT, STREET_BOARD_SIZE } from '/shared/handLog/index.js';
import { CardSlot } from './CardSlot.js';

const e = React.createElement;

const STREET_LABELS = Object.freeze({ preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' });

/**
 * @param {object} props
 * @param {string} props.street one of the street names
 * @param {object} props.value `{board, actions, notes}`
 * @param {object[]} props.seats
 * @param {string[]} props.positions
 * @param {string[]} props.usedCards every card assigned anywhere in the hand
 * @param {string|null} props.openSlot
 * @param {(slotId: string|null) => void} props.onOpenSlot
 * @param {(next: object) => void} props.onChange
 */
export function HandStreetEditor({ street, value, seats, positions, usedCards, openSlot, onOpenSlot, onChange }) {
  const [draft, setDraft] = React.useState({ seatNumber: 0, type: 'fold', amount: '' });

  const boardSize = STREET_BOARD_SIZE[street];
  const needsAmount = ACTION_TYPES_WITH_AMOUNT.includes(draft.type);

  function setBoardCard(index, card) {
    // While editing, the board keeps its holes: a fixed-size array with nulls,
    // the same convention every other card position in this app uses. Closing
    // the gaps here instead would slide a card picked into the third slot down
    // into the first one the moment it was chosen. The nulls are stripped on
    // save by the validator, which is also what rejects a half-dealt street.
    const next = new Array(boardSize).fill(null);
    for (let i = 0; i < boardSize; i += 1) next[i] = value.board[i] ?? null;
    next[index] = next[index] === card ? null : card;
    onChange({ ...value, board: next });
  }

  function addAction(event) {
    event.preventDefault();
    const amount = Number(draft.amount);
    if (needsAmount && (!Number.isFinite(amount) || amount <= 0)) return;

    onChange({
      ...value,
      actions: [...value.actions, {
        seatNumber: Number(draft.seatNumber),
        type: draft.type,
        amount: needsAmount ? amount : 0
      }]
    });
    setDraft({ ...draft, amount: '' });
  }

  function removeAction(index) {
    onChange({ ...value, actions: value.actions.filter((_action, i) => i !== index) });
  }

  const boardSlots = new Array(boardSize).fill(null).map((_unused, index) => value.board[index] ?? null);

  return e(
    'div',
    { className: 'hand-street' },
    e(
      'div',
      { className: 'range-panel-head' },
      e('h3', null, STREET_LABELS[street]),
      boardSize > 0
        ? e(
            'div',
            { className: 'card-slot-row' },
            boardSlots.map((card, index) => {
              const slotId = `${street}-${index}`;
              return e(CardSlot, {
                key: slotId,
                card,
                usedCards: usedCards.filter(used => used !== card),
                isOpen: openSlot === slotId,
                onToggleOpen: () => onOpenSlot(openSlot === slotId ? null : slotId),
                onClose: () => onOpenSlot(null),
                onPick: picked => setBoardCard(index, picked),
                label: `${STREET_LABELS[street]} card ${index + 1}`
              });
            })
          )
        : null
    ),

    e(
      'form',
      { className: 'hand-action-form', onSubmit: addAction },
      e(
        'select',
        {
          value: draft.seatNumber,
          onChange: event => setDraft({ ...draft, seatNumber: event.target.value }),
          'aria-label': 'Acting seat'
        },
        seats.map(seat => e('option', { key: seat.seatNumber, value: seat.seatNumber }, `${positions[seat.seatNumber]} · ${seat.name}`))
      ),
      e(
        'select',
        {
          value: draft.type,
          onChange: event => setDraft({ ...draft, type: event.target.value }),
          'aria-label': 'Action'
        },
        ACTION_TYPES.map(type => e('option', { key: type, value: type }, type))
      ),
      needsAmount
        ? e('input', {
            type: 'number',
            min: 1,
            step: 'any',
            placeholder: 'to',
            value: draft.amount,
            onChange: event => setDraft({ ...draft, amount: event.target.value }),
            'aria-label': 'Total committed on this street'
          })
        : null,
      e('button', { type: 'submit', className: 'ghost-button' }, 'Add')
    ),

    value.actions.length > 0
      ? e(
          'ol',
          { className: 'hand-action-list' },
          value.actions.map((action, index) =>
            e(
              'li',
              { key: `${action.seatNumber}-${action.type}-${index}`, className: 'hand-action-row' },
              e('span', { className: 'hand-action-seat' }, positions[action.seatNumber]),
              e('span', { className: 'hand-action-name' }, seats[action.seatNumber].name),
              e('span', { className: 'hand-action-type' }, action.type),
              action.amount > 0 ? e('strong', null, action.amount.toLocaleString()) : null,
              e('button', {
                type: 'button',
                className: 'ghost-button danger',
                onClick: () => removeAction(index),
                'aria-label': `Remove action ${index + 1}`
              }, '×')
            )
          )
        )
      : e('p', { className: 'footnote' }, 'No actions logged for this street.'),

    e('textarea', {
      className: 'hand-notes',
      rows: 2,
      placeholder: `Notes for the ${STREET_LABELS[street].toLowerCase()}...`,
      value: value.notes,
      maxLength: 2000,
      onChange: event => onChange({ ...value, notes: event.target.value }),
      'aria-label': `${STREET_LABELS[street]} notes`
    })
  );
}
