/**
 * `/shared/:token` -- the public view of a hand someone shared.
 *
 * No auth, no ownership check, nothing gating this route -- see
 * `sharedHandRoutes.js` on the server for why that's structural rather than
 * a permission this page happens to grant. There is no "back to all hands"
 * here on purpose: whoever opened this link may not have an account at all,
 * so the only place worth sending them is the homepage, the same reasoning
 * `goBack`'s fallback already applies to a shared link opened cold.
 */

import { HandDetailView, downloadHand } from '../components/HandDetailView.js';
import { fetchSharedHand } from '../services/apiClient.js';
import { Link } from '../router.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {string} props.token
 */
export function SharedHandPage({ token }) {
  const [hand, setHand] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setHand(null);
    setError(null);

    fetchSharedHand(token)
      .then(loaded => { if (!cancelled) setHand(loaded); })
      .catch(err => { if (!cancelled) setError(err.message); });

    return () => { cancelled = true; };
  }, [token]);

  if (error) {
    return e(
      'div',
      { className: 'hero-card' },
      e('div', { className: 'error-card' }, e('p', null, error)),
      e(Link, { to: '/', className: 'ghost-button' }, 'Back to Poker Lab')
    );
  }

  if (!hand) {
    return e('div', { className: 'hero-card' }, e('p', { className: 'footnote' }, 'Loading hand...'));
  }

  const actions = e(
    React.Fragment,
    null,
    e(Link, { to: '/', className: 'ghost-button' }, 'Poker Lab'),
    e('button', { type: 'button', className: 'ghost-button', onClick: () => downloadHand(hand) }, 'Download')
  );

  return e(HandDetailView, { hand, actions, isSharedView: true });
}
