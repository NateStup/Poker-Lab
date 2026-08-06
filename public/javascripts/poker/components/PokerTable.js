/**
 * The table diagram: seats arranged around an oval felt.
 *
 * Seats are positioned with trigonometry into `left`/`top` percentages rather
 * than drawn with SVG or a canvas -- each seat stays a real DOM button, so it
 * is focusable, clickable and screen-reader-navigable for free, which a
 * painted canvas would have to reimplement.
 *
 * Purely presentational: it renders whatever seats it is handed and reports
 * clicks upward. Position labels are passed in (derived once by the page from
 * `derivePositions`) rather than computed here, so the diagram and the rest of
 * the page can never disagree about who is on the button.
 */

import { CardBadge } from './CardBadge.js';

const e = React.createElement;

/**
 * Where a seat sits on the felt, as CSS percentages.
 *
 * Seat 0 is placed at the bottom centre (where the viewer sits at a real
 * table) and the rest run clockwise from there. The ellipse is deliberately
 * wider than it is tall, matching the felt's own aspect ratio.
 *
 * @param {number} index
 * @param {number} seatCount
 * @returns {{left: string, top: string}}
 */
function seatPosition(index, seatCount) {
  const angle = (Math.PI / 2) + (index / seatCount) * 2 * Math.PI;
  return {
    left: `${50 + 46 * Math.cos(angle)}%`,
    top: `${50 + 42 * Math.sin(angle)}%`
  };
}

/**
 * @param {object} props
 * @param {object[]} props.seats
 * @param {number} props.buttonSeat
 * @param {string[]} props.positions position label per seat, from `derivePositions`
 * @param {number} [props.pot] shown in the middle of the felt when provided
 * @param {number[]} [props.winningSeats]
 * @param {number|null} [props.selectedSeat]
 * @param {(seatNumber: number) => void} [props.onSelectSeat] omit for a read-only diagram
 * @param {string[]} [props.board] community cards shown on the felt
 */
export function PokerTable({
  seats,
  buttonSeat,
  positions,
  pot,
  winningSeats = [],
  selectedSeat = null,
  onSelectSeat,
  board = []
}) {
  const isInteractive = typeof onSelectSeat === 'function';

  return e(
    'div',
    { className: 'poker-table' },
    e(
      'div',
      { className: 'poker-table-felt' },
      board.length > 0
        ? e('div', { className: 'poker-table-board' }, board.map(card => e(CardBadge, { key: card, card })))
        : null,
      pot !== undefined
        ? e(
            'div',
            { className: 'poker-table-pot' },
            e('span', { className: 'stat-label' }, 'Pot'),
            e('strong', null, pot.toLocaleString())
          )
        : null
    ),

    seats.map((seat, index) => {
      const isWinner = winningSeats.includes(seat.seatNumber);
      const classNames = [
        'poker-table-seat',
        seat.isHero ? 'is-hero' : '',
        index === buttonSeat ? 'is-button' : '',
        selectedSeat === index ? 'is-selected' : '',
        isWinner ? 'is-winner' : ''
      ].filter(Boolean).join(' ');

      const cards = seat.cards.filter(Boolean);

      return e(
        isInteractive ? 'button' : 'div',
        {
          key: seat.seatNumber,
          className: classNames,
          style: seatPosition(index, seats.length),
          ...(isInteractive
            ? { type: 'button', onClick: () => onSelectSeat(index), 'aria-pressed': selectedSeat === index }
            : {}),
          title: isInteractive ? `Edit ${seat.name}` : undefined
        },
        e(
          'div',
          { className: 'poker-table-seat-head' },
          e('span', { className: 'poker-table-position' }, positions[index]),
          index === buttonSeat ? e('span', { className: 'poker-table-button-chip', title: 'Dealer button' }, 'D') : null
        ),
        e('span', { className: 'poker-table-seat-name' }, seat.name),
        e('span', { className: 'poker-table-seat-stack footnote' }, seat.stack.toLocaleString()),
        e(
          'div',
          { className: 'poker-table-seat-cards' },
          cards.length > 0
            ? cards.map(card => e(CardBadge, { key: card, card }))
            : e('span', { className: 'preview-placeholder' }, isInteractive ? 'add cards' : '--')
        )
      );
    })
  );
}
