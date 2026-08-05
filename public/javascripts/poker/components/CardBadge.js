/**
 * Rendering primitives for individual cards.
 *
 * Suit symbols and colours come from the shared domain module, so the server,
 * the tests, and the UI all agree on how a card is spelled.
 */

import { SUIT_META, isValidCard } from '/shared/poker/cards.js';

const e = React.createElement;

/**
 * A single card rendered as a coloured chip.
 * @param {{card: string}} props
 */
export function CardBadge({ card }) {
  if (!isValidCard(card)) {
    return e('span', { className: 'card-chip card-chip-unknown' }, '?');
  }

  const suit = SUIT_META[card[1]];

  return e(
    'span',
    { className: `card-chip suit-${suit.color}`, title: `${card[0]} of ${suit.label}` },
    e('span', { className: 'card-chip-rank' }, card[0]),
    e('span', { className: 'card-chip-suit' }, suit.symbol)
  );
}

/**
 * A row of cards, with a placeholder when the list is empty.
 * @param {{cards: string[], placeholder?: string}} props
 */
export function CardList({ cards, placeholder = 'No cards selected' }) {
  if (!cards || cards.length === 0) {
    return e('span', { className: 'preview-placeholder' }, placeholder);
  }

  return e(
    'span',
    { className: 'card-preview-list' },
    cards.map(card => e(CardBadge, { key: card, card }))
  );
}
