/**
 * One street of a hand: its board cards, its betting actions, and its notes.
 *
 * Logging an action is a two-step: pick who is acting, then pick what they
 * did. Everything the second step needs is already knowable -- what it costs
 * to call, what the pot is, what the seat has left -- so this editor works it
 * out (`streetBettingState`) and offers it, rather than asking someone
 * reconstructing a hand from memory to do the arithmetic that the app is
 * going to redo anyway. "Call 600" is one click; the amount is never typed.
 *
 * Amounts are still street *totals*, not increments -- see the note in
 * `shared/handLog/actions.js`. That convention is exactly why filling the
 * amount in automatically matters: "call 600" when you already have 100 out
 * is the single most confusable number in a hand log, and now nobody has to
 * work out which 600 it is.
 *
 * The seat picker defaults to `nextToAct` and is otherwise free. Turn order is
 * a suggestion here, never a rule: a hand reconstructed from memory usually
 * only records the actions that mattered.
 */

import {
  ACTION_TYPES,
  ACTION_TYPES_WITH_AMOUNT,
  STREET_BOARD_SIZE,
  nextToAct,
  streetBettingState
} from '/shared/handLog/index.js';
import { CardSlot } from './CardSlot.js';

const e = React.createElement;

const STREET_LABELS = Object.freeze({ preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' });

/** Bet-sizing shortcuts, as a fraction of the pot after the call is made. */
const POT_FRACTIONS = Object.freeze([
  { label: '½ pot', fraction: 0.5 },
  { label: '¾ pot', fraction: 0.75 },
  { label: 'Pot', fraction: 1 }
]);

/**
 * Round a suggested size to something a person would actually say. Sizing
 * shortcuts are opening offers, not exact maths, and "213" reads as a glitch
 * where "215" reads as a bet.
 *
 * The unit is the *small* blind, not the big one: at 50/100 a pot-sized raise
 * comes to 350, and rounding that to the nearest big blind would round it up
 * to 400 -- a suggestion that overshoots the thing it is named after.
 *
 * @param {number} amount
 * @param {number} step the smallest chip worth rounding to
 * @returns {number}
 */
function roundSize(amount, step) {
  if (step <= 0) return Math.round(amount);
  return Math.round(amount / step) * step;
}

/**
 * @param {object} props
 * @param {string} props.street one of the street names
 * @param {object} props.value `{board, actions, notes}`
 * @param {object} props.hand the whole hand, needed to price this street's
 *   action against everything committed before it
 * @param {object[]} props.seats
 * @param {string[]} props.positions
 * @param {string[]} props.usedCards every card assigned anywhere in the hand
 * @param {string|null} props.openSlot
 * @param {(slotId: string|null) => void} props.onOpenSlot
 * @param {(next: object) => void} props.onChange
 */
export function HandStreetEditor({
  street,
  value,
  hand,
  seats,
  positions,
  usedCards,
  openSlot,
  onOpenSlot,
  onChange
}) {
  const [selectedSeat, setSelectedSeat] = React.useState(null);
  const [amount, setAmount] = React.useState('');

  const boardSize = STREET_BOARD_SIZE[street];
  const state = streetBettingState(hand, street);
  const suggestedSeat = nextToAct(hand, street);

  // The picker follows the suggestion until the user overrides it, and goes
  // back to following after each action is logged (the override is cleared).
  const actingSeat = selectedSeat === null ? suggestedSeat : selectedSeat;

  const committed = actingSeat === null ? 0 : state.committed[actingSeat];
  const behind = actingSeat === null ? 0 : Math.max(0, state.stacks[actingSeat]);
  const toCall = Math.max(0, Math.min(state.highestBet - committed, behind));
  const isFacingBet = toCall > 0;
  const maxTotal = committed + behind;

  // The floor for a voluntary bet: one big blind, or the outstanding bet plus
  // one more when raising. Poker's real min-raise rule is out of scope for a
  // logger (see `actions.js`), so this only bounds the slider -- the number
  // field will still take whatever actually happened.
  const bigBlind = hand.format.bigBlind || 1;
  const chipStep = hand.format.smallBlind || bigBlind;
  const minTotal = Math.min(maxTotal, isFacingBet ? state.highestBet + bigBlind : committed + bigBlind);

  const amountNumber = Number(amount);
  const hasAmount = amount !== '' && Number.isFinite(amountNumber) && amountNumber > 0;

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

  /**
   * @param {string} type
   * @param {number} [total] street total for an action that moves chips
   */
  function addAction(type, total = 0) {
    if (actingSeat === null) return;
    if (ACTION_TYPES_WITH_AMOUNT.includes(type) && !(total > 0)) return;

    onChange({
      ...value,
      actions: [...value.actions, { seatNumber: actingSeat, type, amount: total }]
    });
    setSelectedSeat(null);
    setAmount('');
  }

  function removeAction(index) {
    onChange({ ...value, actions: value.actions.filter((_action, i) => i !== index) });
  }

  /**
   * A pot-sized bet is "call what's out, then bet the pot that leaves" -- the
   * pot after calling includes the call itself, which is the part everyone
   * gets wrong when doing it in their head.
   * @param {number} fraction
   * @returns {number} a street total, capped at the seat's stack
   */
  function potSizedTotal(fraction) {
    const potAfterCall = state.pot + toCall;
    const raw = committed + toCall + potAfterCall * fraction;
    return Math.min(maxTotal, Math.max(minTotal, roundSize(raw, chipStep)));
  }

  const boardSlots = new Array(boardSize).fill(null).map((_unused, index) => value.board[index] ?? null);
  const raiseLabel = isFacingBet ? 'Raise to' : 'Bet';
  const raiseType = isFacingBet ? 'raise' : 'bet';

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

    // A plain div, NOT a form. This editor is rendered inside
    // `HandBuilderForm`'s <form>, and nested forms are invalid HTML -- the
    // browser hands a nested submit button to the *outer* form, so an "Add
    // action" click used to save the whole hand and navigate away. For the
    // same reason every button here must stay `type="button"`: any button
    // inside a form defaults to submitting it.
    actingSeat === null
      ? e('p', { className: 'footnote' }, 'Everyone is all in or folded — no more action to log.')
      : e(
          'div',
          { className: 'hand-action-entry' },
          e(
            'div',
            { className: 'hand-action-who' },
            e(
              'select',
              {
                value: actingSeat,
                onChange: event => setSelectedSeat(Number(event.target.value)),
                'aria-label': 'Acting seat'
              },
              seats.map(seat => e(
                'option',
                { key: seat.seatNumber, value: seat.seatNumber },
                `${positions[seat.seatNumber]} · ${seat.name}`
                + (state.folded[seat.seatNumber] ? ' (folded)' : '')
                + (state.allIn[seat.seatNumber] ? ' (all in)' : '')
              ))
            ),
            e(
              'span',
              { className: 'footnote' },
              `${behind.toLocaleString()} behind`,
              committed > 0 ? ` · ${committed.toLocaleString()} out` : '',
              ` · pot ${state.pot.toLocaleString()}`
            )
          ),

          // The one-click actions. `Call` and `Check` are the same decision
          // seen from either side of a bet, so only the applicable one shows --
          // offering both is how a log ends up with a "check" facing a raise.
          e(
            'div',
            { className: 'hand-action-quick' },
            e('button', {
              type: 'button', className: 'ghost-button', onClick: () => addAction('fold')
            }, 'Fold'),
            isFacingBet
              ? e('button', {
                  type: 'button',
                  className: 'ghost-button',
                  onClick: () => addAction('call', Math.min(state.highestBet, maxTotal))
                },
                // Both numbers, because they are genuinely different questions
                // and the log will show the total: "call 600" is what goes on
                // the record, "+500" is what leaves the stack.
                committed > 0
                  ? `Call ${Math.min(state.highestBet, maxTotal).toLocaleString()} (+${toCall.toLocaleString()})`
                  : `Call ${toCall.toLocaleString()}`)
              : e('button', {
                  type: 'button', className: 'ghost-button', onClick: () => addAction('check')
                }, 'Check'),
            e('button', {
              type: 'button',
              className: 'ghost-button',
              onClick: () => addAction(raiseType, maxTotal)
            }, `All in ${maxTotal.toLocaleString()}`)
          ),

          behind > 0
            ? e(
                'div',
                { className: 'hand-action-sizing' },
                e(
                  'div',
                  { className: 'hand-action-slider-row' },
                  e('input', {
                    type: 'range',
                    className: 'hand-action-slider',
                    min: minTotal,
                    max: maxTotal,
                    step: chipStep,
                    value: hasAmount ? Math.min(Math.max(amountNumber, minTotal), maxTotal) : minTotal,
                    onChange: event => setAmount(event.target.value),
                    'aria-label': `${raiseLabel} amount`
                  }),
                  e('input', {
                    type: 'number',
                    className: 'hand-action-amount',
                    min: 1,
                    step: 'any',
                    placeholder: 'to',
                    value: amount,
                    onChange: event => setAmount(event.target.value),
                    // Enter in a lone number input submits the surrounding
                    // form, which here would save the hand instead of adding
                    // the action the amount was typed for.
                    onKeyDown: event => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      if (hasAmount) addAction(raiseType, amountNumber);
                    },
                    'aria-label': 'Total committed on this street'
                  }),
                  e('button', {
                    type: 'button',
                    disabled: !hasAmount,
                    onClick: () => addAction(raiseType, amountNumber)
                  }, `${raiseLabel} ${hasAmount ? amountNumber.toLocaleString() : ''}`.trim())
                ),
                e(
                  'div',
                  { className: 'hand-action-quick' },
                  POT_FRACTIONS.map(size =>
                    e('button', {
                      key: size.label,
                      type: 'button',
                      className: 'ghost-button',
                      onClick: () => setAmount(String(potSizedTotal(size.fraction)))
                    }, size.label))
                )
              )
            : null
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
