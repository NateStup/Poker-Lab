/**
 * Odds Calculator page.
 *
 * Owns the card-selection state for every slot (each player's two hole
 * cards, plus flop / turn / river). Every individual card position is its own
 * fixed slot -- `players[i]` is always a 2-element `[card|null, card|null]`
 * array, and the board is `{flop: [3], turn: [1], river: [1]}` -- rather than
 * a variable-length array built by pushing cards in whatever order they were
 * picked. That's what lets each position render as its own independent
 * `CardSlot` (card back until clicked, then a picker popover for just that
 * position) instead of the whole hand sharing one picker underneath it.
 *
 * Uses `React.createElement` rather than JSX so the app runs directly in the
 * browser with no build step. See CLAUDE.md for when that tradeoff should be
 * revisited.
 */

import { BOARD_SIZE, HOLE_CARD_COUNT } from '/shared/poker/cards.js';
import { calculateOuts } from '/shared/poker/outs.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '/shared/poker/validation.js';
import { CardSlot } from '../components/CardSlot.js';
import { EquityResult } from '../components/EquityResult.js';
import { HistoryPanel } from '../components/HistoryPanel.js';
import { useHistory } from '../hooks/useHistory.js';
import { calculateEquity } from '../services/apiClient.js';

const e = React.createElement;

/** Practical UI ceiling; the engine itself handles up to MAX_PLAYERS. */
const MAX_PLAYERS_IN_UI = Math.min(6, MAX_PLAYERS);

/** @returns {{players: (string|null)[][], flop: (string|null)[], turn: (string|null)[], river: (string|null)[]}} */
function emptySelection() {
  return {
    players: [[null, null], [null, null]],
    flop: [null, null, null],
    turn: [null],
    river: [null]
  };
}

/**
 * @param {object} selection
 * @returns {string[]} every non-empty card assigned anywhere
 */
function flattenSelection(selection) {
  return [...selection.players.flat(), ...selection.flop, ...selection.turn, ...selection.river].filter(Boolean);
}

/**
 * @param {object} selection
 * @param {string} slotId `'player-{i}-{j}'` or `'{flop|turn|river}-{i}'`
 * @returns {string|null}
 */
function getCard(selection, slotId) {
  const [kind, a, b] = slotId.split('-');
  if (kind === 'player') return selection.players[Number(a)][Number(b)];
  return selection[kind][Number(a)];
}

/**
 * @param {object} selection
 * @param {string} slotId
 * @param {string|null} card
 * @returns {object} a new selection object
 */
function setCard(selection, slotId, card) {
  const [kind, a, b] = slotId.split('-');
  if (kind === 'player') {
    const i = Number(a);
    const j = Number(b);
    return {
      ...selection,
      players: selection.players.map((hand, idx) => (idx === i ? hand.map((c, jdx) => (jdx === j ? card : c)) : hand))
    };
  }
  const i = Number(a);
  return { ...selection, [kind]: selection[kind].map((c, idx) => (idx === i ? card : c)) };
}

export function OddsCalculatorPage() {
  const [selection, setSelection] = React.useState(emptySelection);
  const [openSlot, setOpenSlot] = React.useState(null);
  const [iterations, setIterations] = React.useState(20000);
  const [result, setResult] = React.useState(null);
  const [outs, setOuts] = React.useState(null);
  const [isCalculating, setIsCalculating] = React.useState(false);
  const [error, setError] = React.useState(null);

  const history = useHistory({ limit: 10 });

  /**
   * Cards used elsewhere, for disabling them in one slot's picker -- excludes
   * the slot's own current card, which should stay selectable (clicking it
   * again is how a slot is cleared).
   * @param {string|null} ownCard
   */
  function usedCardsExcluding(ownCard) {
    const all = flattenSelection(selection);
    if (!ownCard) return all;
    const index = all.indexOf(ownCard);
    return index === -1 ? all : [...all.slice(0, index), ...all.slice(index + 1)];
  }

  /**
   * @param {string} slotId
   * @param {string} card
   */
  function pickCard(slotId, card) {
    setSelection(prev => {
      const current = getCard(prev, slotId);
      return setCard(prev, slotId, current === card ? null : card);
    });
  }

  /**
   * @param {string} slotId
   * @param {string} label accessible name for the slot's button
   */
  function renderCardSlot(slotId, label) {
    const card = getCard(selection, slotId);
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

  function addPlayer() {
    if (selection.players.length >= MAX_PLAYERS_IN_UI) return;
    setSelection(prev => ({ ...prev, players: [...prev.players, [null, null]] }));
  }

  function removePlayer(index) {
    if (selection.players.length <= MIN_PLAYERS) return;
    setSelection(prev => ({ ...prev, players: prev.players.filter((_, i) => i !== index) }));
    // Slot ids are derived from array position, so a removal shifts every
    // later player's ids -- simplest to just close whatever was open.
    setOpenSlot(null);
  }

  function resetAll() {
    setSelection(emptySelection());
    setOpenSlot(null);
    setResult(null);
    setOuts(null);
    setError(null);
  }

  /**
   * Restore a saved calculation into the form so it can be re-run or tweaked.
   * @param {object} record
   */
  function replayRecord(record) {
    const board = record.request.board || [];
    setSelection({
      players: record.request.players.map(hand => [hand[0] ?? null, hand[1] ?? null]),
      flop: [board[0] ?? null, board[1] ?? null, board[2] ?? null],
      turn: [board[3] ?? null],
      river: [board[4] ?? null]
    });
    setOpenSlot(null);
    setResult(null);
    setOuts(null);
    setError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const incomplete = selection.players.findIndex(hand => hand.filter(Boolean).length !== HOLE_CARD_COUNT);
    if (incomplete !== -1) {
      setError({ message: `Player ${incomplete + 1} needs exactly ${HOLE_CARD_COUNT} hole cards.` });
      return;
    }

    const board = [...selection.flop, ...selection.turn, ...selection.river].filter(Boolean);
    // The API only accepts boards at a street boundary; catching it here gives
    // a clearer message than a round trip would.
    if (![0, 3, 4, BOARD_SIZE].includes(board.length)) {
      setError({ message: 'The board must be empty, or a complete flop, turn, or river.' });
      return;
    }

    setIsCalculating(true);
    setResult(null);
    setOuts(null);

    try {
      const response = await calculateEquity({ players: selection.players, board, iterations });
      setResult(response);
      // Outs are only a well-defined heads-up concept with a board still in
      // motion (see outs.js) -- exact and cheap enough to compute right here,
      // no server round trip needed.
      if (selection.players.length === 2 && (board.length === 3 || board.length === 4)) {
        setOuts(calculateOuts({ players: selection.players, board }));
      }
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
      e('h1', null, 'Poker Odds Calculator'),
      e('p', { className: 'small' },
        'Exact enumeration when the runouts are countable, seeded Monte Carlo when they are not.'),

      e(
        'form',
        { className: 'card-form', onSubmit: handleSubmit },

        e(
          'div',
          { className: 'card-slot-groups' },
          selection.players.map((hand, i) =>
            e(
              'div',
              { key: `player-${i}`, className: 'card-slot-group' },
              e(
                'div',
                { className: 'card-slot-group-head' },
                e('span', { className: 'card-slot-group-label' }, `Player ${i + 1}`),
                selection.players.length > MIN_PLAYERS
                  ? e('button', {
                      type: 'button',
                      className: 'ghost-button danger',
                      onClick: () => removePlayer(i),
                      'aria-label': `Remove player ${i + 1}`
                    }, '×')
                  : null
              ),
              e(
                'div',
                { className: 'card-slot-row' },
                [0, 1].map(j => renderCardSlot(`player-${i}-${j}`, `Player ${i + 1}, card ${j + 1}`))
              )
            )
          ),
          selection.players.length < MAX_PLAYERS_IN_UI
            ? e(
                'div',
                { className: 'card-slot-group' },
                e('span', { className: 'card-slot-group-label' }, ' '),
                e('button', { type: 'button', className: 'ghost-button', onClick: addPlayer }, '+ Add player')
              )
            : null
        ),

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
              isCalculating ? 'Calculating...' : 'Calculate odds'),
            e('button', { type: 'button', className: 'ghost-button', onClick: resetAll }, 'Reset')
          )
        )
      ),

      e(EquityResult, { result, outs, isLoading: isCalculating, error })
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
