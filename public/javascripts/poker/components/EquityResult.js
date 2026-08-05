/**
 * Result, loading, and error presentation for an equity calculation.
 *
 * The one detail worth surfacing prominently is `method`: when the server
 * enumerated every remaining runout the number is exact, and saying so is more
 * honest than reporting a sample size that implies uncertainty that isn't there.
 */

import { CardList } from './CardBadge.js';

const e = React.createElement;

/** @param {number} value a fraction in [0, 1] */
function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * @param {object} props
 * @param {object|null} props.result
 * @param {boolean} props.isLoading
 * @param {{message: string, details?: string[]}|null} props.error
 */
export function EquityResult({ result, isLoading, error }) {
  if (error) {
    return e(
      'div',
      { className: 'result-card error-card', role: 'alert' },
      e('h3', null, 'Calculation issue'),
      e('p', null, error.message),
      error.details?.length
        ? e('ul', { className: 'error-details' }, error.details.map((detail, i) => e('li', { key: i }, detail)))
        : null
    );
  }

  if (isLoading) {
    return e(
      'div',
      { className: 'result-card loading-card' },
      e('h3', null, 'Running simulation...'),
      e('p', null, 'Dealing runouts and scoring showdowns.')
    );
  }

  if (!result) {
    return e(
      'div',
      { className: 'result-card placeholder-card' },
      e('p', { className: 'footnote' }, 'Pick two hole cards for each player, then calculate.')
    );
  }

  const isExact = result.method === 'exact';

  return e(
    'div',
    { className: 'result-card summary-card' },
    e(
      'div',
      { className: 'result-header' },
      e('h3', null, 'Equity'),
      e(
        'span',
        { className: `method-badge ${isExact ? 'is-exact' : 'is-sampled'}` },
        isExact ? 'Exact' : 'Monte Carlo'
      )
    ),
    e(
      'div',
      { className: 'equity-rows' },
      result.players.map(player =>
        e(
          'div',
          { key: player.index, className: 'equity-row' },
          e(
            'div',
            { className: 'equity-row-head' },
            e('span', { className: 'stat-label' }, `Player ${player.index + 1}`),
            e(CardList, { cards: player.cards })
          ),
          e(
            'div',
            { className: 'equity-bar' },
            e('div', { className: 'equity-bar-fill', style: { width: percent(player.equity) } })
          ),
          e(
            'div',
            { className: 'equity-numbers' },
            e('strong', null, percent(player.equity)),
            e('span', { className: 'footnote' }, `win ${percent(player.win)} / tie ${percent(player.tie)}`)
          )
        )
      )
    ),
    e(
      'p',
      { className: 'footnote' },
      isExact
        ? `Exhausted all ${result.possibleRunouts.toLocaleString()} possible runouts in ${result.durationMs} ms.`
        : `Sampled ${result.iterations.toLocaleString()} of ${result.possibleRunouts.toLocaleString()} runouts in ${result.durationMs} ms (seed ${result.seed}).`
    ),
    result.board?.length
      ? e('p', { className: 'footnote board-line' }, 'Board: ', e(CardList, { cards: result.board }))
      : e('p', { className: 'footnote' }, 'Board: random runout')
  );
}
