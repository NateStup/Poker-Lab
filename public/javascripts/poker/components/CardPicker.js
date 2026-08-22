/**
 * The 52-card selection table shown inside a `CardSlot`'s popover.
 *
 * Deliberately scoped to picking exactly one card for one slot: `currentCard`
 * highlights the slot's existing pick, and every other card already used by
 * another slot is disabled. The picker itself is stateless -- all
 * card-assignment state lives in the owning page.
 *
 * Emptying a filled slot is its own button. Re-clicking the highlighted card
 * does it too and always did, but that was invisible: nothing said so,
 * and the highlight was styled with a `not-allowed` cursor, so the one way to
 * undo a pick looked specifically like the thing you were not allowed to do.
 * An affordance nobody can find is the same as a missing feature.
 */

import { RANKS, SUITS, SUIT_META } from '/shared/poker/cards.js';
import { CardBadge } from './CardBadge.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string|null} props.currentCard the card already assigned to this slot, if any
 * @param {string[]} props.usedCards every card assigned to some other slot
 * @param {(card: string|null) => void} props.onPick called with the card to
 *   assign, or `null` to empty the slot (which is also what re-clicking the
 *   already-assigned card sends)
 */
export function CardPicker({ currentCard, usedCards, onPick }) {
  const used = new Set(usedCards);

  return e(
    'div',
    { className: 'card-picker' },
    SUITS.map(suitCode => {
      const suit = SUIT_META[suitCode];

      return e(
        'div',
        { key: suitCode, className: 'picker-row', 'data-suit': suitCode },
        e('span', { className: `picker-row-label suit-${suit.color}` }, suit.symbol),
        RANKS.map(rank => {
          const card = `${rank}${suitCode}`;
          const isSelected = card === currentCard;
          // Taken by a different slot: visible but not clickable.
          const isUsedElsewhere = used.has(card) && !isSelected;

          return e(
            'button',
            {
              key: card,
              type: 'button',
              className: [
                'card-option',
                isSelected ? 'is-selected' : '',
                isUsedElsewhere ? 'is-used' : ''
              ].filter(Boolean).join(' '),
              'aria-label': isSelected ? `Remove ${rank} of ${suit.label}` : `${rank} of ${suit.label}`,
              'aria-pressed': isSelected,
              disabled: isUsedElsewhere,
              // The picker, not each caller, decides what a click means. Every
              // consumer used to repeat the same `existing === picked ? null :
              // picked` toggle, which is four copies of one rule.
              onClick: () => onPick(isSelected ? null : card)
            },
            e(CardBadge, { card })
          );
        })
      );
    }),
    currentCard
      ? e(
          'div',
          { className: 'card-picker-footer' },
          e(
            'button',
            {
              type: 'button',
              className: 'ghost-button danger card-picker-clear',
              onClick: () => onPick(null)
            },
            'Remove card'
          )
        )
      : null
  );
}
