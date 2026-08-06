/**
 * The prize pool breakdown -- amounts come from the server's `derived.payouts`
 * (computed by `calculatePayouts`), never recomputed here. This component
 * only cross-references each paid place with whoever actually finished
 * there, once eliminations have produced a finishing order.
 *
 * While the tournament is still in `setup`, a paid-places stepper lets the
 * organizer override the field-size suggestion -- `suggestPaidPlaces` is
 * deliberately just a default (see CLAUDE.md), and without this control
 * there was no way to reach a wider split than whatever the server guessed
 * at creation time, before any players had registered.
 */

import { MAX_SUGGESTED_PLACES } from '/shared/tournament/index.js';

const e = React.createElement;

/** @param {number} amount @returns {string} */
function formatMoney(amount) {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * @param {object} props
 * @param {number} props.prizePool
 * @param {Array<{place: number, percent: number, amount: number}>} props.payouts
 * @param {object[]} props.players
 * @param {boolean} [props.isEditable] whether the paid-places stepper is shown
 * @param {(places: number) => void} [props.onChangePlaces]
 */
export function TournamentPayouts({ prizePool, payouts, players, isEditable = false, onChangePlaces }) {
  const finisherByPlace = new Map(players.filter(player => player.place != null).map(player => [player.place, player]));
  const paidPlaces = payouts.length;

  return e(
    'div',
    { className: 'tournament-payouts' },
    e(
      'div',
      { className: 'range-panel-head' },
      e('h2', null, 'Payouts'),
      e('div', { className: 'range-stats' }, e('strong', null, formatMoney(prizePool)), e('div', { className: 'footnote' }, 'prize pool'))
    ),
    isEditable
      ? e(
          'div',
          { className: 'tournament-payout-places' },
          e('span', { className: 'footnote' }, 'Paid places'),
          e('button', {
            type: 'button',
            className: 'ghost-button',
            disabled: paidPlaces <= 1,
            'aria-label': 'Pay one fewer place',
            onClick: () => onChangePlaces(paidPlaces - 1)
          }, '−'),
          e('strong', null, String(paidPlaces)),
          e('button', {
            type: 'button',
            className: 'ghost-button',
            disabled: paidPlaces >= MAX_SUGGESTED_PLACES,
            'aria-label': 'Pay one more place',
            onClick: () => onChangePlaces(paidPlaces + 1)
          }, '+')
        )
      : null,
    e(
      'ul',
      { className: 'tournament-payout-list' },
      payouts.map(payout => {
        const finisher = finisherByPlace.get(payout.place);
        return e(
          'li',
          { key: payout.place, className: 'tournament-payout-row' },
          e('span', { className: 'tournament-place-badge' }, `#${payout.place}`),
          e('span', { className: 'tournament-payout-name' }, finisher ? finisher.name : e('span', { className: 'preview-placeholder' }, 'TBD')),
          e('span', { className: 'footnote' }, `${payout.percent}%`),
          e('strong', null, formatMoney(payout.amount))
        );
      })
    )
  );
}
