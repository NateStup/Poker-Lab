/**
 * One clickable card position: shows a card back when empty, the card face
 * when filled, and opens a `CardPicker` popover on click.
 *
 * Only one `CardSlot`'s popover is meant to be open at a time -- the owning
 * page tracks that as a single `openSlot` id and passes `isOpen` down, rather
 * than each slot managing its own open state, so opening one slot closes any
 * other that was already open.
 */

import { CardBadge } from './CardBadge.js';
import { CardPicker } from './CardPicker.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string|null} props.card the card currently assigned, or `null`/`undefined` if empty
 * @param {string[]} props.usedCards every card assigned to some other slot
 * @param {boolean} props.isOpen whether this slot's picker popover is open
 * @param {() => void} props.onToggleOpen open this slot's popover, or close it if already open
 * @param {() => void} props.onClose close this slot's popover (e.g. on an outside click)
 * @param {(card: string) => void} props.onPick a card was chosen (or the current one re-clicked to clear it)
 * @param {string} props.label accessible name, e.g. "Player 1, card 1"
 */
export function CardSlot({ card, usedCards, isOpen, onToggleOpen, onClose, onPick, label }) {
  const wrapperRef = React.useRef(null);

  React.useEffect(() => {
    if (!isOpen) return undefined;

    // Closing on an outside click (rather than only via picking a card) is
    // what makes the popover feel dismissable, the way a native <select> is.
    function handlePointerDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        onClose();
      }
    }
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isOpen, onClose]);

  return e(
    'div',
    { className: 'card-slot-wrapper', ref: wrapperRef },
    e(
      'button',
      {
        type: 'button',
        className: `card-slot ${card ? 'is-filled' : 'is-empty'} ${isOpen ? 'is-open' : ''}`,
        onClick: onToggleOpen,
        'aria-label': label,
        'aria-expanded': isOpen
      },
      card ? e(CardBadge, { card, size: 'lg' }) : e('span', { className: 'card-back', 'aria-hidden': 'true' })
    ),
    isOpen
      ? e(
          React.Fragment,
          null,
          // The picker can be taller than the room below its slot, so a
          // backdrop makes it read as a layer on top of the rest of the
          // form instead of overlapping nearby buttons and text.
          e('div', { className: 'card-picker-backdrop', 'aria-hidden': 'true', onClick: onClose }),
          e(
            'div',
            { className: 'card-picker-popover' },
            e(CardPicker, {
              currentCard: card || null,
              usedCards,
              onPick: picked => {
                onPick(picked);
                onClose();
              }
            })
          )
        )
      : null
  );
}
