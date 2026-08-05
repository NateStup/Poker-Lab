/**
 * Range Explorer page.
 *
 * Builds a hero range on a 13x13 grid, an opponent that is either a specific
 * hand or another range, and an optional board, then runs it through
 * `/api/ranges/equity`. That endpoint always samples (see `rangeEquity.js`
 * for why averaging exact per-combo equities isn't tractable for a request),
 * so unlike the Equity Calculator there is no exact/sampled toggle to surface
 * -- the method badge is always "Monte Carlo".
 *
 * Reuses `CardPicker` / `CardSlotButton` from the Equity Calculator for the
 * villain-hand and board card selection, which is what keeps the two pages
 * feeling like one product instead of two.
 */

import { HOLE_CARD_COUNT } from '/shared/poker/cards.js';
import { ALL_HANDS, TOTAL_COMBOS, rangeComboCount } from '/shared/poker/ranges.js';
import { CardPicker } from '../components/CardPicker.js';
import { CardSlotButton } from '../components/CardSlotButton.js';
import { RangeEquityResult } from '../components/RangeEquityResult.js';
import { RangeGrid } from '../components/RangeGrid.js';
import { calculateRangeEquity } from '../services/apiClient.js';

const e = React.createElement;

/** Board slots, in dealing order, with their capacities -- same shape the Equity Calculator uses. */
const BOARD_SLOTS = Object.freeze([
  { id: 'flop', label: 'Flop', max: 3 },
  { id: 'turn', label: 'Turn', max: 1 },
  { id: 'river', label: 'River', max: 1 }
]);

/** @returns {{flop: string[], turn: string[], river: string[]}} */
function emptyBoard() {
  return { flop: [], turn: [], river: [] };
}

/**
 * @param {number} combos
 * @returns {string} e.g. "34 combos (2.6%)"
 */
function comboSummary(combos) {
  const percent = ((combos / TOTAL_COMBOS) * 100).toFixed(1);
  return `${combos} combo${combos === 1 ? '' : 's'} (${percent}%)`;
}

export function RangeExplorerPage() {
  const [heroHands, setHeroHands] = React.useState(() => new Set());
  const [villainMode, setVillainMode] = React.useState('hand');
  const [villainHands, setVillainHands] = React.useState(() => new Set());
  const [villainCards, setVillainCards] = React.useState([]);
  const [board, setBoard] = React.useState(emptyBoard);
  const [activeSlot, setActiveSlot] = React.useState('villain-hand');
  const [iterations, setIterations] = React.useState(20000);
  const [result, setResult] = React.useState(null);
  const [isCalculating, setIsCalculating] = React.useState(false);
  const [error, setError] = React.useState(null);

  // The villain-hand card picker only makes sense in 'hand' mode; if the user
  // switches to 'range' while it's targeted, retarget to the board instead of
  // leaving the picker aimed at a slot that's no longer shown.
  React.useEffect(() => {
    if (villainMode === 'range' && activeSlot === 'villain-hand') {
      setActiveSlot('flop');
    }
  }, [villainMode, activeSlot]);

  const boardCards = [...board.flop, ...board.turn, ...board.river];
  const usedCards = villainMode === 'hand' ? [...villainCards, ...boardCards] : boardCards;

  const heroCombos = React.useMemo(() => rangeComboCount([...heroHands]), [heroHands]);
  const villainCombos = React.useMemo(() => rangeComboCount([...villainHands]), [villainHands]);

  function activeCardsFor(slot) {
    if (slot === 'villain-hand') return villainCards;
    return board[slot] || [];
  }

  function slotCapacityFor(slot) {
    if (slot === 'villain-hand') return HOLE_CARD_COUNT;
    return BOARD_SLOTS.find(s => s.id === slot)?.max || 0;
  }

  function slotLabelFor(slot) {
    if (slot === 'villain-hand') return 'Villain hand';
    return BOARD_SLOTS.find(s => s.id === slot)?.label || slot;
  }

  function writeSlot(slot, cards) {
    if (slot === 'villain-hand') {
      setVillainCards(cards);
      return;
    }
    setBoard(prev => ({ ...prev, [slot]: cards }));
  }

  function advanceSlotIfFull(slot, newLength) {
    if (newLength < slotCapacityFor(slot)) return;
    const order = villainMode === 'hand'
      ? ['villain-hand', 'flop', 'turn', 'river']
      : ['flop', 'turn', 'river'];
    const next = order[order.indexOf(slot) + 1];
    if (next) setActiveSlot(next);
  }

  function toggleCard(card) {
    const current = activeCardsFor(activeSlot);
    const isSelected = current.includes(card);

    if (!isSelected && usedCards.includes(card)) return;

    if (isSelected) {
      writeSlot(activeSlot, current.filter(c => c !== card));
      return;
    }

    if (current.length >= slotCapacityFor(activeSlot)) return;

    writeSlot(activeSlot, [...current, card]);
    advanceSlotIfFull(activeSlot, current.length + 1);
  }

  function resetAll() {
    setHeroHands(new Set());
    setVillainHands(new Set());
    setVillainCards([]);
    setBoard(emptyBoard());
    setActiveSlot('villain-hand');
    setResult(null);
    setError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (heroHands.size === 0) {
      setError({ message: 'Select at least one hand for the hero range.' });
      return;
    }

    let villain;
    if (villainMode === 'hand') {
      if (villainCards.length !== HOLE_CARD_COUNT) {
        setError({ message: 'Pick exactly two cards for the villain hand.' });
        return;
      }
      villain = { cards: villainCards };
    } else {
      if (villainHands.size === 0) {
        setError({ message: 'Select at least one hand for the villain range.' });
        return;
      }
      villain = { hands: [...villainHands] };
    }

    if (![0, 3, 4, 5].includes(boardCards.length)) {
      setError({ message: 'The board must be empty, or a complete flop, turn, or river.' });
      return;
    }

    setIsCalculating(true);
    setResult(null);

    try {
      const response = await calculateRangeEquity({
        heroRange: [...heroHands],
        villain,
        board: boardCards,
        iterations
      });
      setResult(response);
    } catch (err) {
      setError({ message: err.message, details: err.details });
    } finally {
      setIsCalculating(false);
    }
  }

  const isPickerActive = activeSlot === 'villain-hand' || BOARD_SLOTS.some(slot => slot.id === activeSlot);

  return e(
    'div',
    { className: 'hero-card' },
    e('h1', null, 'Poker Range Explorer'),
    e('p', { className: 'small' },
      'Build a hero range, choose an opponent hand or range, and see equity via seeded Monte Carlo sampling.'),

    e(
      'div',
      { className: 'range-layout' },

      e(
        'div',
        { className: 'range-panel' },
        e(
          'div',
          { className: 'range-panel-head' },
          e('h2', null, 'Hero range'),
          e(
            'div',
            { className: 'range-stats' },
            e('strong', null, `${heroHands.size} hands`),
            e('div', { className: 'footnote' }, comboSummary(heroCombos))
          )
        ),
        e(RangeGrid, { selected: heroHands, onChange: setHeroHands, role: 'hero' }),
        e(
          'div',
          { className: 'range-legend' },
          e('span', { className: 'range-legend-item' },
            e('span', { className: 'range-legend-swatch role-hero' }), 'Hero selected'),
          e('span', null, 'Click a cell, or press and drag to paint several at once.')
        ),
        e(
          'div',
          { className: 'button-group', style: { marginTop: '0.75rem' } },
          e('button', { type: 'button', className: 'ghost-button', onClick: () => setHeroHands(new Set()) }, 'Clear'),
          e('button', {
            type: 'button',
            className: 'ghost-button',
            onClick: () => setHeroHands(new Set(ALL_HANDS))
          }, 'Select all')
        )
      ),

      e(
        'div',
        { className: 'range-side-panel' },

        e(
          'div',
          { className: 'range-panel' },
          e(
            'div',
            { className: 'range-panel-head' },
            e('h2', null, 'Villain'),
            e(
              'div',
              { className: 'villain-mode-tabs' },
              e('button', {
                type: 'button',
                className: villainMode === 'hand' ? 'is-active' : '',
                onClick: () => setVillainMode('hand')
              }, 'Specific hand'),
              e('button', {
                type: 'button',
                className: villainMode === 'range' ? 'is-active' : '',
                onClick: () => setVillainMode('range')
              }, 'Range')
            )
          ),

          villainMode === 'hand'
            ? e('div', { className: 'villain-hand-preview' },
                e(CardSlotButton, {
                  slotId: 'villain-hand',
                  label: 'Villain hand',
                  cards: villainCards,
                  isActive: activeSlot === 'villain-hand',
                  onSelect: setActiveSlot,
                  onRemove: null
                })
              )
            : e(
                React.Fragment,
                null,
                e(
                  'div',
                  { className: 'range-stats', style: { textAlign: 'left', marginBottom: '0.5rem' } },
                  e('strong', null, `${villainHands.size} hands `),
                  e('span', { className: 'footnote' }, comboSummary(villainCombos))
                ),
                e(RangeGrid, { selected: villainHands, onChange: setVillainHands, role: 'villain' }),
                e(
                  'div',
                  { className: 'range-legend' },
                  e('span', { className: 'range-legend-item' },
                    e('span', { className: 'range-legend-swatch role-villain' }), 'Villain selected')
                ),
                e(
                  'div',
                  { className: 'button-group', style: { marginTop: '0.75rem' } },
                  e('button', {
                    type: 'button',
                    className: 'ghost-button',
                    onClick: () => setVillainHands(new Set())
                  }, 'Clear'),
                  e('button', {
                    type: 'button',
                    className: 'ghost-button',
                    onClick: () => setVillainHands(new Set(ALL_HANDS))
                  }, 'Select all')
                )
              )
        ),

        e(
          'div',
          { className: 'range-panel' },
          e('h2', null, 'Board (optional)'),
          e(
            'div',
            { className: 'slot-grid' },
            BOARD_SLOTS.map(slot =>
              e(CardSlotButton, {
                key: slot.id,
                slotId: slot.id,
                label: slot.label,
                cards: board[slot.id],
                isActive: activeSlot === slot.id,
                onSelect: setActiveSlot,
                onRemove: null
              })
            )
          )
        ),

        isPickerActive
          ? e(CardPicker, {
              selectedCards: activeCardsFor(activeSlot),
              usedCards,
              onToggle: toggleCard,
              targetLabel: slotLabelFor(activeSlot)
            })
          : null,

        e(
          'form',
          { className: 'card-form', onSubmit: handleSubmit },
          e(
            'div',
            { className: 'form-footer' },
            e(
              'div',
              { className: 'field-group' },
              e('label', { htmlFor: 'range-iterations' }, 'Monte Carlo samples'),
              e('input', {
                id: 'range-iterations',
                type: 'number',
                min: 100,
                max: 500000,
                // See EquityCalculatorPage.js: step must divide evenly into
                // (value - min) or the browser silently blocks submission.
                step: 100,
                value: iterations,
                onChange: event => setIterations(Number(event.target.value) || 100)
              }),
              e('span', { className: 'footnote' },
                'Range spots are always sampled -- there is no board-only case small enough to enumerate exactly.')
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

        e(RangeEquityResult, { result, isLoading: isCalculating, error, villainMode })
      )
    )
  );
}
