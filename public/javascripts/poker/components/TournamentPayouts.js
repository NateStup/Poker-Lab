/**
 * The prize pool breakdown -- amounts come from the server's `derived.payouts`
 * (computed by `calculatePayouts`), never recomputed here. This component
 * only cross-references each paid place with whoever actually finished
 * there, once eliminations have produced a finishing order.
 */

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
 */
export function TournamentPayouts({ prizePool, payouts, players }) {
  const finisherByPlace = new Map(players.filter(player => player.place != null).map(player => [player.place, player]));

  return e(
    'div',
    { className: 'tournament-payouts' },
    e(
      'div',
      { className: 'range-panel-head' },
      e('h2', null, 'Payouts'),
      e('div', { className: 'range-stats' }, e('strong', null, formatMoney(prizePool)), e('div', { className: 'footnote' }, 'prize pool'))
    ),
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
