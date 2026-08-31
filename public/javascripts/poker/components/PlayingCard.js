/**
 * A card drawn as an actual playing card -- white face, rank and pip in the
 * corner, a large suit in the middle -- rather than the compact `CardBadge`
 * chip.
 *
 * Both exist on purpose and are not interchangeable. `CardBadge` is a token
 * sized to sit inline in a sentence or a result row ("As Kd beat 7h7c"); this
 * is a card sized to be *looked at* on the felt, where the board and the hole
 * cards are the thing the reader is studying. Rendering the felt with badges
 * made a hand read like a list of codes instead of a table.
 *
 * Suit symbols and colours still come from `SUIT_META`, so there is one
 * spelling of a card across the app no matter which of the two renders it.
 */

import { SUIT_META, isValidCard } from '/shared/poker/cards.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string|null} props.card e.g. `'As'`; anything invalid renders face-down
 * @param {'sm'|'md'|'lg'} [props.size] `sm` for hole cards on the felt, `md` for the
 *   board, `lg` for a showcase
 * @param {boolean} [props.faceDown] render the back even when a card is supplied
 * @param {boolean} [props.isDimmed] mute the card (a folded seat's holding)
 */
export function PlayingCard({ card, size = 'md', faceDown = false, isDimmed = false }) {
  const classNames = ['playing-card', `playing-card-${size}`, isDimmed ? 'is-dimmed' : ''];

  if (faceDown || !isValidCard(card)) {
    return e('span', {
      className: [...classNames, 'is-face-down'].filter(Boolean).join(' '),
      'aria-hidden': 'true'
    });
  }

  const suit = SUIT_META[card[1]];

  return e(
    'span',
    {
      className: [...classNames, `suit-${suit.color}`].filter(Boolean).join(' '),
      role: 'img',
      'aria-label': `${card[0]} of ${suit.label}`,
      title: `${card[0]} of ${suit.label}`
    },
    e('span', { className: 'playing-card-rank' }, card[0]),
    // U+FE0E is the text-presentation selector. Without it the suit characters
    // are free to render as colour emoji (Windows in particular substitutes
    // Segoe UI Emoji), which at card size came out as a garbled blob rather
    // than a pip. `--font-symbol` in the stylesheet is the other half of the
    // fix: a font stack that actually has these glyphs as text.
    e('span', { className: 'playing-card-suit' }, `${suit.symbol}\uFE0E`)
  );
}

/**
 * A row of playing cards, padded out with face-down cards so a partly-dealt
 * street still occupies the space its cards will fill -- without that, the
 * board jumps sideways as each card lands during a replay.
 *
 * @param {object} props
 * @param {Array<string|null>} props.cards
 * @param {number} [props.slots] pad to this many positions with face-down cards
 * @param {'sm'|'md'|'lg'} [props.size]
 * @param {boolean} [props.isDimmed]
 */
export function PlayingCardRow({ cards, slots = 0, size = 'md', isDimmed = false }) {
  const padded = [...cards];
  while (padded.length < slots) padded.push(null);

  return e(
    'span',
    { className: 'playing-card-row' },
    padded.map((card, index) =>
      e(PlayingCard, { key: `${card || 'back'}-${index}`, card, size, isDimmed }))
  );
}
