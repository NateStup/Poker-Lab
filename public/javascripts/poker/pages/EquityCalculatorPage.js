/**
 * Equity Calculator page.
 *
 * Owns the card-selection state for every slot (each player's hole cards, plus
 * flop / turn / river). Holding it in one place is what makes global card
 * exclusivity trivial: a card assigned anywhere is unavailable everywhere, and
 * the picker simply reads that derived set.
 *
 * Uses `React.createElement` rather than JSX so the app runs directly in the
 * browser with no build step. See CLAUDE.md for when that tradeoff should be
 * revisited.
 */

import { BOARD_SIZE, HOLE_CARD_COUNT } from '/shared/poker/cards.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '/shared/poker/validation.js';
import { CardPicker } from '../components/CardPicker.js';
import { CardSlotButton } from '../components/CardSlotButton.js';
import { EquityResult } from '../components/EquityResult.js';
import { HistoryPanel } from '../components/HistoryPanel.js';
import { useHistory } from '../hooks/useHistory.js';
import { calculateEquity } from '../services/apiClient.js';

const e = React.createElement;

/** Board slots, in dealing order, with their capacities. */
const BOARD_SLOTS = Object.freeze([
  { id: 'flop', label: 'Flop', max: 3 },
  { id: 'turn', label: 'Turn', max: 1 },
  { id: 'river', label: 'River', max: 1 }
]);

/** Practical UI ceiling; the engine itself handles up to MAX_PLAYERS. */
const MAX_PLAYERS_IN_UI = Math.min(6, MAX_PLAYERS);

/** @returns {{players: string[][], flop: string[], turn: string[], river: string[]}} */
function emptySelection() {
  return { players: [[], []], flop: [], turn: [], river: [] };
}

export function EquityCalculatorPage() {
  const [selection, setSelection] = React.useState(emptySelection);
  const [activeSlot, setActiveSlot] = React.useState('player-0');
  const [iterations, setIterations] = React.useState(20000);
  const [result, setResult] = React.useState(null);
  const [isCalculating, setIsCalculating] = React.useState(false);
  const [error, setError] = React.useState(null);

  const history = useHistory({ limit: 10 });

  /** Every card currently assigned to any slot. */
  const usedCards = React.useMemo(
    () => [...selection.players.flat(), ...selection.flop, ...selection.turn, ...selection.river],
    [selection]
  );

  /** Cards in the slot the picker is currently filling. */
  const activeCards = readSlot(selection, activeSlot);
  const activeSlotLabel = describeSlot(activeSlot);

  /**
   * Add or remove a card from the active slot. Cards held by another slot are
   * rejected here as well as being disabled in the picker.
   * @param {string} card
   */
  function toggleCard(card) {
    const current = readSlot(selection, activeSlot);
    const isSelected = current.includes(card);

    if (!isSelected && usedCards.includes(card)) return;

    if (isSelected) {
      setSelection(prev => writeSlot(prev, activeSlot, current.filter(c => c !== card)));
      return;
    }

    if (current.length >= slotCapacity(activeSlot)) return;

    setSelection(prev => writeSlot(prev, activeSlot, [...current, card]));
    advanceSlotIfFull(current.length + 1);
  }

  /**
   * Move the picker to the next slot once the current one fills up, so all four
   * hole cards can be chosen without re-targeting between each pair.
   * @param {number} newLength
   */
  function advanceSlotIfFull(newLength) {
    if (newLength < slotCapacity(activeSlot)) return;

    const order = [
      ...selection.players.map((_, i) => `player-${i}`),
      ...BOARD_SLOTS.map(slot => slot.id)
    ];
    const next = order[order.indexOf(activeSlot) + 1];
    if (next) setActiveSlot(next);
  }

  function addPlayer() {
    if (selection.players.length >= MAX_PLAYERS_IN_UI) return;
    setSelection(prev => ({ ...prev, players: [...prev.players, []] }));
  }

  function removePlayer(index) {
    if (selection.players.length <= MIN_PLAYERS) return;
    setSelection(prev => ({ ...prev, players: prev.players.filter((_, i) => i !== index) }));
    if (activeSlot === `player-${index}`) setActiveSlot('player-0');
  }

  function resetAll() {
    setSelection(emptySelection());
    setActiveSlot('player-0');
    setResult(null);
    setError(null);
  }

  /**
   * Restore a saved calculation into the form so it can be re-run or tweaked.
   * @param {object} record
   */
  function replayRecord(record) {
    const board = record.request.board || [];
    setSelection({
      players: record.request.players.map(hand => [...hand]),
      flop: board.slice(0, 3),
      turn: board.slice(3, 4),
      river: board.slice(4, 5)
    });
    setActiveSlot('player-0');
    setResult(null);
    setError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const incomplete = selection.players.findIndex(hand => hand.length !== HOLE_CARD_COUNT);
    if (incomplete !== -1) {
      setError({ message: `Player ${incomplete + 1} needs exactly ${HOLE_CARD_COUNT} hole cards.` });
      return;
    }

    const board = [...selection.flop, ...selection.turn, ...selection.river];
    // The API only accepts boards at a street boundary; catching it here gives
    // a clearer message than a round trip would.
    if (![0, 3, 4, BOARD_SIZE].includes(board.length)) {
      setError({ message: 'The board must be empty, or a complete flop, turn, or river.' });
      return;
    }

    setIsCalculating(true);
    setResult(null);

    try {
      const response = await calculateEquity({ players: selection.players, board, iterations });
      setResult(response);
      await history.refresh();
    } catch (err) {
      setError({ message: err.message, details: err.details });
    } finally {
      setIsCalculating(false);
    }
  }

  return e(
    React.Fragment,
    null,
    e(
      'div',
      { className: 'hero-card' },
      e('h1', null, 'Poker Equity Calculator'),
      e('p', { className: 'small' },
        'Exact enumeration when the runouts are countable, seeded Monte Carlo when they are not.'),

      e(
        'form',
        { className: 'card-form', onSubmit: handleSubmit },

        e(
          'div',
          { className: 'slot-section' },
          e(
            'div',
            { className: 'slot-section-head' },
            e('label', null, 'Players'),
            e(
              'button',
              {
                type: 'button',
                className: 'ghost-button',
                onClick: addPlayer,
                disabled: selection.players.length >= MAX_PLAYERS_IN_UI
              },
              '+ Add player'
            )
          ),
          e(
            'div',
            { className: 'slot-grid' },
            selection.players.map((cards, index) =>
              e(CardSlotButton, {
                key: `player-${index}`,
                slotId: `player-${index}`,
                label: `Player ${index + 1}`,
                cards,
                isActive: activeSlot === `player-${index}`,
                onSelect: setActiveSlot,
                onRemove: selection.players.length > MIN_PLAYERS ? () => removePlayer(index) : null
              })
            )
          )
        ),

        e(
          'div',
          { className: 'slot-section' },
          e('label', null, 'Board (optional)'),
          e(
            'div',
            { className: 'slot-grid' },
            BOARD_SLOTS.map(slot =>
              e(CardSlotButton, {
                key: slot.id,
                slotId: slot.id,
                label: slot.label,
                cards: selection[slot.id],
                isActive: activeSlot === slot.id,
                onSelect: setActiveSlot,
                onRemove: null
              })
            )
          )
        ),

        e(CardPicker, {
          selectedCards: activeCards,
          usedCards,
          onToggle: toggleCard,
          targetLabel: activeSlotLabel
        }),

        e(
          'div',
          { className: 'form-footer' },
          e(
            'div',
            { className: 'field-group' },
            e('label', { htmlFor: 'iterations' }, 'Monte Carlo samples'),
            e('input', {
              id: 'iterations',
              type: 'number',
              min: 100,
              max: 500000,
              // Must divide evenly into (value - min): with a 1000 step and
              // min 100, the browser's own number-input validation rejects
              // round values like the 20000 default, blocking submission
              // with no visible error beyond a native tooltip.
              step: 100,
              value: iterations,
              onChange: event => setIterations(Number(event.target.value) || 100)
            }),
            e('span', { className: 'footnote' },
              'Ignored when the remaining runouts can be enumerated exactly.')
          ),
          e(
            'div',
            { className: 'form-actions' },
            e('button', { type: 'submit', disabled: isCalculating },
              isCalculating ? 'Calculating...' : 'Calculate equity'),
            e('button', { type: 'button', className: 'ghost-button', onClick: resetAll }, 'Reset')
          )
        )
      ),

      e(EquityResult, { result, isLoading: isCalculating, error })
    ),

    e(HistoryPanel, {
      records: history.records,
      total: history.total,
      isLoading: history.isLoading,
      error: history.error,
      onReplay: replayRecord,
      onDelete: history.remove,
      onClear: history.clear
    })
  );
}

/**
 * @param {object} selection
 * @param {string} slotId
 * @returns {string[]}
 */
function readSlot(selection, slotId) {
  if (slotId.startsWith('player-')) {
    return selection.players[Number(slotId.slice(7))] || [];
  }
  return selection[slotId] || [];
}

/**
 * @param {object} selection
 * @param {string} slotId
 * @param {string[]} cards
 * @returns {object} a new selection object
 */
function writeSlot(selection, slotId, cards) {
  if (slotId.startsWith('player-')) {
    const index = Number(slotId.slice(7));
    return {
      ...selection,
      players: selection.players.map((hand, i) => (i === index ? cards : hand))
    };
  }
  return { ...selection, [slotId]: cards };
}

/**
 * @param {string} slotId
 * @returns {number} how many cards the slot holds
 */
function slotCapacity(slotId) {
  if (slotId.startsWith('player-')) return HOLE_CARD_COUNT;
  return BOARD_SLOTS.find(slot => slot.id === slotId)?.max || 0;
}

/**
 * @param {string} slotId
 * @returns {string} a human-readable slot name
 */
function describeSlot(slotId) {
  if (slotId.startsWith('player-')) return `Player ${Number(slotId.slice(7)) + 1}`;
  return BOARD_SLOTS.find(slot => slot.id === slotId)?.label || slotId;
}
