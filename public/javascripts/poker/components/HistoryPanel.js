/**
 * Recent calculations, read back from the server's data store.
 *
 * This panel is the visible half of the persistence layer: it proves the round
 * trip from browser to API to disk and back. The same records will feed the
 * session tracker, so the row shape here is intentionally close to what the
 * store holds rather than a UI-only projection.
 *
 * History is owner-scoped now, with no unscoped fallback -- a logged-out
 * visitor gets no fetch attempt at all (see `useHistory.js`), so this panel
 * replaces its usual content with a short message and a login link rather
 * than rendering an empty list. Kept inline rather than sharing a component
 * with `TournamentListView`'s own logged-out footnote: it's one paragraph and
 * a link, and the two render in different contexts (a footnote beside a list
 * that still shows something, versus this panel's only content).
 */

import { CardList } from './CardBadge.js';
import { Link } from '../router.js';

const e = React.createElement;

/**
 * Render an ISO timestamp in the viewer's locale.
 * @param {string} iso
 */
function formatTimestamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * @param {object} props
 * @param {object[]} props.records
 * @param {number} props.total
 * @param {boolean} props.isLoading
 * @param {string|null} props.error
 * @param {boolean} props.isAuthenticated
 * @param {(record: object) => void} props.onReplay load a record back into the form
 * @param {(id: string) => void} props.onDelete
 * @param {() => void} props.onClear
 */
export function HistoryPanel({ records, total, isLoading, error, isAuthenticated, onReplay, onDelete, onClear }) {
  if (!isAuthenticated) {
    return e(
      'section',
      { className: 'history-panel' },
      e('h3', null, 'Recent calculations'),
      e(
        'p',
        { className: 'footnote' },
        "Log in to see your recent calculations. ",
        e(Link, { to: '/login' }, 'Log in')
      )
    );
  }

  return e(
    'section',
    { className: 'history-panel' },
    e(
      'div',
      { className: 'history-header' },
      e('h3', null, 'Recent calculations'),
      records.length > 0
        ? e('button', { type: 'button', className: 'ghost-button', onClick: onClear }, 'Clear all')
        : null
    ),

    error ? e('p', { className: 'history-error', role: 'alert' }, error) : null,

    isLoading && records.length === 0
      ? e('p', { className: 'footnote' }, 'Loading history...')
      : null,

    !isLoading && records.length === 0 && !error
      ? e('p', { className: 'footnote' }, 'Nothing saved yet. Run a calculation and it will appear here.')
      : null,

    records.length > 0
      ? e(
          'ul',
          { className: 'history-list' },
          records.map(record =>
            e(
              'li',
              { key: record.id, className: 'history-item' },
              e(
                'div',
                { className: 'history-item-main' },
                e(
                  'div',
                  { className: 'history-hands' },
                  record.result.players.map(player =>
                    e(
                      'span',
                      { key: player.index, className: 'history-hand' },
                      e(CardList, { cards: player.cards }),
                      e('strong', null, `${(player.equity * 100).toFixed(1)}%`)
                    )
                  )
                ),
                e(
                  'div',
                  { className: 'history-meta' },
                  e('span', null, formatTimestamp(record.createdAt)),
                  e('span', { className: 'history-method' }, record.result.method),
                  record.result.board?.length
                    ? e(CardList, { cards: record.result.board })
                    : e('span', null, 'preflop')
                )
              ),
              e(
                'div',
                { className: 'history-actions' },
                e(
                  'button',
                  { type: 'button', className: 'ghost-button', onClick: () => onReplay(record) },
                  'Load'
                ),
                e(
                  'button',
                  {
                    type: 'button',
                    className: 'ghost-button danger',
                    onClick: () => onDelete(record.id),
                    'aria-label': 'Delete this record'
                  },
                  '×'
                )
              )
            )
          )
        )
      : null,

    total > records.length
      ? e('p', { className: 'footnote' }, `Showing ${records.length} of ${total} saved records.`)
      : null
  );
}
