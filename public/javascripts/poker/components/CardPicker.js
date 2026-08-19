/**
 * The 52-card selection table shown inside a `CardSlot`'s popover.
 *
 * Deliberately scoped to picking exactly one card for one slot: `currentCard`
 * highlights the slot's existing pick (clicking it again clears the slot),
 * and every other card already used by another slot is disabled. The picker
 * itself is stateless -- all card-assignment state lives in the owning page.
 */

import { RANKS, SUITS, SUIT_META } from '/shared/poker/cards.js';
import { CardBadge } from './CardBadge.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string|null} props.currentCard the card already assigned to this slot, if any
 * @param {string[]} props.usedCards every card assigned to some other slot
 * @param {(card: string) => void} props.onPick called with the clicked card;
 *   the caller decides whether that means "assign" or "clear" (clicking the
 *   already-assigned card again is how a slot is cleared)
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
              'aria-label': `${rank} of ${suit.label}`,
              'aria-pressed': isSelected,
              disabled: isUsedElsewhere,
              onClick: () => onPick(card)
            },
            e(CardBadge, { card })
          );
        })
      );
    })
  );
}
