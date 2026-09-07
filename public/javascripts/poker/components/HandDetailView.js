/**
 * The body of a hand's page -- header, tabs, replay/summary -- shared by the
 * owner's `/hands/:id` and the public `/shared/:token` view.
 *
 * Deliberately knows nothing about editing, deleting, or sharing. Which
 * actions appear in the header is entirely up to the caller, passed in as
 * already-built elements -- this component only lays out the hand itself,
 * the same split `PokerTable` draws between geometry and paint, applied to
 * "what a hand looks like" versus "what you're allowed to do to it."
 */

import { derivePositions } from '/shared/handLog/index.js';
import { HandReplay } from './HandReplay.js';
import { HandSummary } from './HandSummary.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {object} props.hand
 * @param {*} [props.actions] rendered in the header's action row
 * @param {boolean} [props.isSharedView] shows the "view only" badge
 */
export function HandDetailView({ hand, actions, isSharedView = false }) {
  const [tab, setTab] = React.useState('replay');
  const positions = derivePositions(hand.seats.length, hand.buttonSeat);

  return e(
    'div',
    { className: 'hero-card' },
    e(
      'div',
      { className: 'tournament-header' },
      e(
        'div',
        null,
        e('h1', null, hand.name),
        e(
          'p',
          { className: 'small' },
          `${hand.format.gameType} · ${hand.seats.length}-handed · saved ${new Date(hand.createdAt).toLocaleDateString()}`
        ),
        isSharedView ? e('span', { className: 'hand-view-only-badge' }, 'Shared hand · view only') : null
      ),
      e('div', { className: 'form-actions' }, actions)
    ),

    e(
      'div',
      { className: 'hand-tabs' },
      e(
        'button',
        {
          type: 'button',
          className: `ghost-button ${tab === 'replay' ? 'is-active' : ''}`,
          onClick: () => setTab('replay'),
          'aria-pressed': tab === 'replay'
        },
        'Replay'
      ),
      e(
        'button',
        {
          type: 'button',
          className: `ghost-button ${tab === 'summary' ? 'is-active' : ''}`,
          onClick: () => setTab('summary'),
          'aria-pressed': tab === 'summary'
        },
        'Full write-up'
      )
    ),

    tab === 'replay' ? e(HandReplay, { hand, positions }) : e(HandSummary, { hand })
  );
}

/**
 * Save a hand as a JSON file the browser downloads -- the "download" half of
 * "view or download" for a shared hand, and available on the owner's own
 * page for the same reason. Client-side only: the response this app already
 * fetched has everything in it, so there's nothing further to ask the
 * server for.
 *
 * The anchor is appended to the document before the click and removed right
 * after, and the revoke is deferred a tick rather than called synchronously
 * -- clicking an anchor that was never in the document, then revoking its
 * blob URL in the same tick, has a history of racing in Safari specifically:
 * the download can be revoked before the browser has actually started
 * reading the blob, which silently fails it.
 * @param {object} hand
 */
export function downloadHand(hand) {
  const blob = new Blob([JSON.stringify(hand, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${(hand.name || 'hand').replace(/[^\w.-]+/g, '_')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
