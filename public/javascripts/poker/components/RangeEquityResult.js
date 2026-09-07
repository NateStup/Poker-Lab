/**
 * Result, loading, and error presentation for a range-equity calculation.
 *
 * Structurally close to `EquityResult`, but laid out as two side-by-side
 * columns (hero / villain) since a range spot is always exactly that
 * matchup, and always tagged 'sampled' -- see `rangeEquity.js` for why there
 * is no exact-enumeration case once a range is involved.
 */

import { CardList } from './CardBadge.js';

const e = React.createElement;

/** @param {number} value a fraction in [0, 1] */
function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * @param {string} label
 * @param {{equity: number, win: number, tie: number, comboCount: number}} side
 * @param {'hero'|'villain'} role
 */
function EquitySide(label, side, role) {
  return e(
    'div',
    { className: 'range-equity-side' },
    e(
      'div',
      { className: 'equity-row-head' },
      e('span', { className: 'stat-label' }, label),
      e('span', { className: 'footnote' }, `${side.comboCount} combo${side.comboCount === 1 ? '' : 's'}`)
    ),
    e(
      'div',
      { className: 'equity-bar' },
      e('div', {
        className: `equity-bar-fill ${role === 'villain' ? 'role-villain' : ''}`,
        style: { width: percent(side.equity) }
      })
    ),
    e(
      'div',
      { className: 'equity-numbers' },
      e('strong', null, percent(side.equity)),
      e('span', { className: 'footnote' }, `win ${percent(side.win)} / tie ${percent(side.tie)}`)
    )
  );
}

/**
 * @param {object} props
 * @param {object|null} props.result
 * @param {boolean} props.isLoading
 * @param {{message: string, details?: string[]}|null} props.error
 * @param {'hand'|'range'} props.villainMode
 */
export function RangeEquityResult({ result, isLoading, error, villainMode }) {
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
      e('h3', null, 'Sampling the matchup...'),
      e('p', null, 'Drawing combos from each range and dealing runouts.')
    );
  }

  if (!result) {
    return null;
  }

  return e(
    'div',
    { className: 'result-card summary-card' },
    e(
      'div',
      { className: 'result-header' },
      e('h3', null, 'Range equity'),
      e('span', { className: 'method-badge is-sampled' }, 'Monte Carlo')
    ),
    e(
      'div',
      { className: 'range-equity-columns' },
      EquitySide('Hero range', result.hero, 'hero'),
      EquitySide(villainMode === 'hand' ? 'Villain hand' : 'Villain range', result.villain, 'villain')
    ),
    e(
      'p',
      { className: 'footnote' },
      `Sampled ${result.iterations.toLocaleString()} runouts in ${result.durationMs} ms (seed ${result.seed}).`
    ),
    result.board?.length
      ? e('p', { className: 'footnote board-line' }, 'Board: ', e(CardList, { cards: result.board }))
      : e('p', { className: 'footnote' }, 'Board: random runout')
  );
}
