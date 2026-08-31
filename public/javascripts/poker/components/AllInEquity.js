/**
 * Live equity for an all-in run-out, shown between the table and the timeline.
 *
 * This is the odds calculator pointed at a logged hand: the same
 * `calculateEquity` the calculator page posts to the API, called locally
 * against the frame's board. Because the replay steps a card at a time, the
 * numbers move the way they do at a real table when the dealer puts out a turn
 * that changes everything -- which is most of what someone opening a shared
 * all-in wants to see.
 *
 * `method` is displayed for the same reason the calculator displays it: a flop
 * with two cards to come is enumerated exactly, a preflop all-in is sampled,
 * and "94%" means something different in each case.
 */

import { PlayingCard } from './PlayingCard.js';

const e = React.createElement;

/** @param {number} fraction @returns {string} */
function formatPercent(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * @param {object} props
 * @param {object[]} props.seats the hand's seats, for names
 * @param {string[]} props.positions
 * @param {{seats: Array<{seatNumber: number, cards: string[], equity: number, tie: number}>, method: string}} props.equity
 * @param {number} props.cardsToCome
 */
export function AllInEquity({ seats, positions, equity, cardsToCome }) {
  const ranked = [...equity.seats].sort((a, b) => b.equity - a.equity);
  const best = ranked[0];

  return e(
    'div',
    { className: 'all-in-equity' },
    e(
      'div',
      { className: 'range-panel-head' },
      e('h3', null, 'All in — equity'),
      e(
        'span',
        { className: 'footnote' },
        `${cardsToCome} card${cardsToCome === 1 ? '' : 's'} to come · `,
        e('span', { className: `method-badge ${equity.method === 'exact' ? 'is-exact' : 'is-sampled'}` },
          equity.method === 'exact' ? 'Exact' : 'Monte Carlo')
      )
    ),
    e(
      'ul',
      { className: 'all-in-equity-list' },
      ranked.map(entry => {
        // A dead heat between the leaders shouldn't crown either of them, so
        // the marker keys off the value rather than the sort order.
        const isLeader = entry.equity === best.equity;

        return e(
          'li',
          { key: entry.seatNumber, className: `all-in-equity-row ${isLeader ? 'is-leader' : ''}` },
          e('span', { className: 'hand-action-seat' }, positions[entry.seatNumber]),
          e('span', { className: 'hand-action-name' }, seats[entry.seatNumber].name),
          e('span', { className: 'playing-card-row' },
            entry.cards.map(card => e(PlayingCard, { key: card, card, size: 'sm' }))),
          e(
            'span',
            { className: 'all-in-equity-bar', 'aria-hidden': 'true' },
            e('span', { className: 'all-in-equity-fill', style: { width: `${entry.equity * 100}%` } })
          ),
          e('strong', { className: 'all-in-equity-value' }, formatPercent(entry.equity)),
          entry.tie > 0
            ? e('span', { className: 'footnote' }, `chops ${formatPercent(entry.tie)}`)
            : null
        );
      })
    )
  );
}
