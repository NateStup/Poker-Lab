/**
 * A clickable target representing one card slot (a player's hand, a board
 * street). Shared by the Equity Calculator and the Range Explorer so both
 * pages target the same `CardPicker` the same way.
 */

import { CardList } from './CardBadge.js';

const e = React.createElement;

/**
 * @param {{slotId: string, label: string, cards: string[], isActive: boolean,
 *   onSelect: (id: string) => void, onRemove: (() => void)|null}} props
 */
export function CardSlotButton({ slotId, label, cards, isActive, onSelect, onRemove }) {
  return e(
    'div',
    { className: 'slot-wrapper' },
    e(
      'button',
      {
        type: 'button',
        className: `picker-target ${isActive ? 'is-active' : ''}`,
        onClick: () => onSelect(slotId),
        'aria-pressed': isActive
      },
      e('span', { className: 'slot-label' }, label),
      e('span', { className: 'preview-text' }, e(CardList, { cards, placeholder: 'Empty' }))
    ),
    onRemove
      ? e('button', {
          type: 'button',
          className: 'ghost-button danger slot-remove',
          onClick: onRemove,
          'aria-label': `Remove ${label}`
        }, '×')
      : null
  );
}
