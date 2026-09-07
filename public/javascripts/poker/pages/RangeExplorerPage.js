/**
 * Range Explorer page.
 *
 * Builds a hero range on a 13x13 grid, an opponent that is either a specific
 * hand or another range, and an optional board, then runs it through
 * `/api/ranges/equity`. That endpoint always samples (see `rangeEquity.js`
 * for why averaging exact per-combo equities isn't tractable for a request),
 * so unlike the Odds Calculator there is no exact/sampled toggle to surface
 * -- the method badge is always "Monte Carlo".
 *
 * Layout: the hero and villain ranges sit as two evenly weighted columns
 * (`.range-columns`), and everything needed to actually run the calculation
 * -- board, sample size, actions -- lives in one full-width panel below both,
 * with the result under that. Reuses `CardSlot` from the Odds Calculator for
 * the villain-hand and board card selection, which is what keeps the two
 * pages feeling like one product instead of two.
 */

import { ALL_HANDS, TOTAL_COMBOS, rangeComboCount, selectTopPercent } from '/shared/poker/ranges.js';
import { clearBoardCard } from '../boardSlots.js';
import { CardSlot } from '../components/CardSlot.js';
import { RangeEquityResult } from '../components/RangeEquityResult.js';
import { RangeGrid } from '../components/RangeGrid.js';
import { RangeNotation } from '../components/RangeNotation.js';
import { calculateRangeEquity } from '../services/apiClient.js';

const e = React.createElement;

/** @returns {{flop: (string|null)[], turn: (string|null)[], river: (string|null)[]}} */
function emptyBoard() {
  return { flop: [null, null, null], turn: [null], river: [null] };
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
  const [heroPercent, setHeroPercent] = React.useState(0);
  const [villainMode, setVillainMode] = React.useState('hand');
  const [villainHands, setVillainHands] = React.useState(() => new Set());
  const [villainPercent, setVillainPercent] = React.useState(0);
  const [villainCards, setVillainCards] = React.useState([null, null]);
  const [board, setBoard] = React.useState(emptyBoard);
  const [openSlot, setOpenSlot] = React.useState(null);
  const [iterations, setIterations] = React.useState(20000);
  const [result, setResult] = React.useState(null);
  const [isCalculating, setIsCalculating] = React.useState(false);
  const [error, setError] = React.useState(null);

  const boardCards = [...board.flop, ...board.turn, ...board.river].filter(Boolean);
  const allUsedCards = villainMode === 'hand' ? [...villainCards.filter(Boolean), ...boardCards] : boardCards;

  const heroCombos = React.useMemo(() => rangeComboCount([...heroHands]), [heroHands]);
  const villainCombos = React.useMemo(() => rangeComboCount([...villainHands]), [villainHands]);

  function applyHeroPercent(value) {
    setHeroPercent(value);
    setHeroHands(new Set(selectTopPercent(value)));
  }

  function applyVillainPercent(value) {
    setVillainPercent(value);
    setVillainHands(new Set(selectTopPercent(value)));
  }

  /**
   * @param {string} slotId `'villain-{i}'` or `'{flop|turn|river}-{i}'`
   * @returns {string|null}
   */
  function getCard(slotId) {
    const [kind, i] = slotId.split('-');
    if (kind === 'villain') return villainCards[Number(i)];
    return board[kind][Number(i)];
  }

  /**
   * @param {string} slotId
   * @param {string|null} card the chosen card, or `null` to empty the slot
   */
  function pickCard(slotId, card) {
    const [kind, iStr] = slotId.split('-');
    const i = Number(iStr);

    if (kind === 'villain') {
      setVillainCards(prev => prev.map((c, idx) => (idx === i ? card : c)));
      return;
    }

    // Emptying a board card clears the streets after it too -- see
    // boardSlots.js: this page flattens the board the same way, so it has the
    // same silent mis-read to avoid.
    if (card === null) {
      setBoard(prev => clearBoardCard(prev, kind, i));
      return;
    }

    setBoard(prev => ({ ...prev, [kind]: prev[kind].map((c, idx) => (idx === i ? card : c)) }));
  }

  /**
   * @param {string|null} ownCard
   */
  function usedCardsExcluding(ownCard) {
    if (!ownCard) return allUsedCards;
    const index = allUsedCards.indexOf(ownCard);
    return index === -1 ? allUsedCards : [...allUsedCards.slice(0, index), ...allUsedCards.slice(index + 1)];
  }

  /**
   * @param {string} slotId
   * @param {string} label
   */
  function renderCardSlot(slotId, label) {
    const card = getCard(slotId);
    return e(CardSlot, {
      key: slotId,
      card,
      usedCards: usedCardsExcluding(card),
      isOpen: openSlot === slotId,
      onToggleOpen: () => setOpenSlot(prev => (prev === slotId ? null : slotId)),
      onClose: () => setOpenSlot(null),
      onPick: picked => pickCard(slotId, picked),
      label
    });
  }

  function resetAll() {
    setHeroHands(new Set());
    setHeroPercent(0);
    setVillainHands(new Set());
    setVillainPercent(0);
    setVillainCards([null, null]);
    setBoard(emptyBoard());
    setOpenSlot(null);
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
      if (villainCards.filter(Boolean).length !== 2) {
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

  return e(
    'div',
    { className: 'hero-card' },
    e('h1', null, 'Poker Range Explorer'),
    e('p', { className: 'small' },
      'Build a hero range, choose an opponent hand or range, and see equity via seeded Monte Carlo sampling.'),

    e(
      'div',
      { className: 'range-columns' },

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
          { className: 'range-slider-row' },
          e('label', { htmlFor: 'hero-percent' }, 'Top %'),
          e('input', {
            id: 'hero-percent',
            type: 'range',
            min: 0,
            max: 100,
            step: 1,
            value: heroPercent,
            onChange: event => applyHeroPercent(Number(event.target.value))
          }),
          e('span', { className: 'range-slider-value' }, `${heroPercent}%`)
        ),
        e(
          'div',
          { className: 'range-legend' },
          e('span', { className: 'range-legend-item' },
            e('span', { className: 'range-legend-swatch role-hero' }), 'Selected'),
          e('span', null, 'Click, drag, or use the slider.')
        ),
        e(
          'div',
          { className: 'button-group' },
          e('button', {
            type: 'button',
            className: 'ghost-button',
            onClick: () => { setHeroHands(new Set()); setHeroPercent(0); }
          }, 'Clear'),
          e('button', {
            type: 'button',
            className: 'ghost-button',
            onClick: () => { setHeroHands(new Set(ALL_HANDS)); setHeroPercent(100); }
          }, 'Select all')
        ),
        e(RangeNotation, {
          hands: heroHands,
          onApply: hands => { setHeroHands(new Set(hands)); setHeroPercent(0); }
        })
      ),

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
          ? e(
              'div',
              { className: 'villain-hand-slot' },
              [0, 1].map(j => renderCardSlot(`villain-${j}`, `Villain hand, card ${j + 1}`))
            )
          : e(
              React.Fragment,
              null,
              e(
                'div',
                { className: 'range-stats', style: { textAlign: 'left' } },
                e('strong', null, `${villainHands.size} hands `),
                e('span', { className: 'footnote' }, comboSummary(villainCombos))
              ),
              e(RangeGrid, { selected: villainHands, onChange: setVillainHands, role: 'villain' }),
              e(
                'div',
                { className: 'range-slider-row role-villain' },
                e('label', { htmlFor: 'villain-percent' }, 'Top %'),
                e('input', {
                  id: 'villain-percent',
                  type: 'range',
                  min: 0,
                  max: 100,
                  step: 1,
                  value: villainPercent,
                  onChange: event => applyVillainPercent(Number(event.target.value))
                }),
                e('span', { className: 'range-slider-value' }, `${villainPercent}%`)
              ),
              e(
                'div',
                { className: 'range-legend' },
                e('span', { className: 'range-legend-item' },
                  e('span', { className: 'range-legend-swatch role-villain' }), 'Selected'),
                e('span', null, 'Click, drag, or use the slider.')
              ),
              e(
                'div',
                { className: 'button-group' },
                e('button', {
                  type: 'button',
                  className: 'ghost-button',
                  onClick: () => { setVillainHands(new Set()); setVillainPercent(0); }
                }, 'Clear'),
                e('button', {
                  type: 'button',
                  className: 'ghost-button',
                  onClick: () => { setVillainHands(new Set(ALL_HANDS)); setVillainPercent(100); }
                }, 'Select all')
              ),
              e(RangeNotation, {
                hands: villainHands,
                onApply: hands => { setVillainHands(new Set(hands)); setVillainPercent(0); }
              })
            )
      )
    ),

    e(
      'div',
      { className: 'range-panel range-controls' },
      e(
        'div',
        { className: 'card-slot-groups' },
        e(
          'div',
          { className: 'card-slot-group' },
          e('span', { className: 'card-slot-group-label' }, 'Flop'),
          e('div', { className: 'card-slot-row' }, [0, 1, 2].map(k => renderCardSlot(`flop-${k}`, `Flop, card ${k + 1}`)))
        ),
        e(
          'div',
          { className: 'card-slot-group' },
          e('span', { className: 'card-slot-group-label' }, 'Turn'),
          e('div', { className: 'card-slot-row' }, [renderCardSlot('turn-0', 'Turn')])
        ),
        e(
          'div',
          { className: 'card-slot-group' },
          e('span', { className: 'card-slot-group-label' }, 'River'),
          e('div', { className: 'card-slot-row' }, [renderCardSlot('river-0', 'River')])
        )
      ),

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
              // See OddsCalculatorPage.js: step must divide evenly into
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
      )
    ),

    e(RangeEquityResult, { result, isLoading: isCalculating, error, villainMode })
  );
}
