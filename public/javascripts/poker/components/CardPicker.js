/**
 * The 52-card selection grid.
 *
 * The picker is deliberately stateless: it renders from `selectedCards` and
 * `usedCards` and reports clicks upward. All selection state lives in the App,
 * which is what allows a card taken by one player to be greyed out everywhere
 * else without any cross-component coordination.
 */

import { RANKS, SUITS, SUIT_META } from '/shared/poker/cards.js';
import { CardBadge } from './CardBadge.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string[]} props.selectedCards cards in the currently targeted slot
 * @param {string[]} props.usedCards every card assigned anywhere
 * @param {(card: string) => void} props.onToggle
 * @param {string} props.targetLabel name of the slot being filled
 */
export function CardPicker({ selectedCards, usedCards, onToggle, targetLabel }) {
  const used = new Set(usedCards);
  const selected = new Set(selectedCards);

  return e(
    'div',
    { className: 'card-picker-panel' },
    e('h3', null, 'Select cards'),
    e('p', null, `Clicking a card adds it to: ${targetLabel}. Click again to remove it.`),
    e(
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
            const isSelected = selected.has(card);
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
                onClick: () => onToggle(card)
              },
              e(CardBadge, { card })
            );
          })
        );
      })
    )
  );
}
