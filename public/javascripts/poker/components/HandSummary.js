/**
 * A saved hand, read-only -- what someone opening a shared link sees.
 *
 * Every number rendered here comes from the server's `derived` block rather
 * than being recomputed in the browser, so two people looking at the same
 * link are looking at the same arithmetic.
 */

import { STREET_NAMES } from '/shared/handLog/index.js';
import { CardBadge } from './CardBadge.js';
import { PokerTable } from './PokerTable.js';

const e = React.createElement;

const STREET_LABELS = Object.freeze({ preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' });

/** @param {number} amount @returns {string} */
function formatChips(amount) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * @param {object} props
 * @param {object} props.hand a decorated hand record (with `derived`)
 */
export function HandSummary({ hand }) {
  const { derived } = hand;
  const hero = hand.seats.find(seat => seat.isHero);
  const heroNet = hero ? derived.netBySeat[hero.seatNumber] : 0;

  return e(
    'div',
    { className: 'hand-summary' },

    e(
      'div',
      { className: 'tournament-stats-bar' },
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Pot'),
        e('strong', null, formatChips(derived.totalPot))),
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Stakes'),
        e('strong', null, `${formatChips(hand.format.smallBlind)}/${formatChips(hand.format.bigBlind)}`)),
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Table'),
        e('strong', null, `${hand.seats.length}-handed`)),
      e('div', { className: 'stat-box' },
        e('span', { className: 'stat-label' }, 'Hero result'),
        e('strong', { className: heroNet >= 0 ? 'hand-net-up' : 'hand-net-down' },
          `${heroNet >= 0 ? '+' : ''}${formatChips(heroNet)}`))
    ),

    e(PokerTable, {
      seats: hand.seats,
      buttonSeat: hand.buttonSeat,
      positions: derived.positions,
      pot: derived.totalPot,
      winningSeats: hand.result.winningSeats,
      board: STREET_NAMES.flatMap(street => hand.streets[street].board)
    }),

    derived.forcedBets.length > 0
      ? e(
          'p',
          { className: 'footnote' },
          'Posted: ',
          derived.forcedBets
            .map(bet => `${hand.seats[bet.seatNumber].name} ${formatChips(bet.amount)}`)
            .join(', ')
        )
      : null,

    e(
      'div',
      { className: 'hand-summary-streets' },
      STREET_NAMES.map(street => {
        const value = hand.streets[street];
        const isEmpty = value.board.length === 0 && value.actions.length === 0 && !value.notes;
        if (isEmpty && street !== 'preflop') return null;

        return e(
          'div',
          { key: street, className: 'hand-summary-street' },
          e(
            'div',
            { className: 'range-panel-head' },
            e('h3', null, STREET_LABELS[street]),
            e(
              'div',
              { className: 'board-line' },
              value.board.map(card => e(CardBadge, { key: card, card })),
              e('span', { className: 'footnote' }, `pot ${formatChips(derived.potAfterStreet[street])}`)
            )
          ),
          value.actions.length > 0
            ? e(
                'ol',
                { className: 'hand-action-list' },
                value.actions.map((action, index) =>
                  e(
                    'li',
                    { key: `${street}-${index}`, className: 'hand-action-row' },
                    e('span', { className: 'hand-action-seat' }, derived.positions[action.seatNumber]),
                    e('span', { className: 'hand-action-name' }, hand.seats[action.seatNumber].name),
                    e('span', { className: 'hand-action-type' }, action.type),
                    action.amount > 0 ? e('strong', null, formatChips(action.amount)) : null
                  )
                )
              )
            : e('p', { className: 'footnote' }, 'No action logged.'),
          value.notes ? e('p', { className: 'hand-summary-notes' }, value.notes) : null
        );
      })
    ),

    e(
      'div',
      { className: 'range-panel' },
      e('h3', null, 'Result'),
      derived.payouts.length > 0
        ? e(
            'ul',
            { className: 'tournament-payout-list' },
            derived.payouts.map(payout =>
              e(
                'li',
                { key: payout.seatNumber, className: 'tournament-payout-row' },
                e('span', { className: 'tournament-place-badge' }, derived.positions[payout.seatNumber]),
                e('span', { className: 'tournament-payout-name' }, hand.seats[payout.seatNumber].name),
                e('strong', null, formatChips(payout.amount))
              )
            )
          )
        : e('p', { className: 'footnote' }, 'No winner recorded for this hand.'),
      hand.result.notes ? e('p', { className: 'hand-summary-notes' }, hand.result.notes) : null
    )
  );
}
