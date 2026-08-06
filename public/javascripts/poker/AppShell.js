/**
 * Root component: the page shell (header/nav/footer) every page shares, plus
 * the route switch that decides which page renders inside it.
 *
 * Still no router dependency -- see `router.js`. The Hand Logger introduced
 * the first route that carries an id (`/hands/:id`, because a saved hand has
 * to be linkable), and it needed exactly one `startsWith` here rather than a
 * matching library.
 */

import { Nav } from './components/Nav.js';
import { HandDetailPage } from './pages/HandDetailPage.js';
import { HandLoggerPage } from './pages/HandLoggerPage.js';
import { OddsCalculatorPage } from './pages/OddsCalculatorPage.js';
import { RangeExplorerPage } from './pages/RangeExplorerPage.js';
import { TournamentManagerPage } from './pages/TournamentManagerPage.js';
import { useRoute } from './router.js';

const e = React.createElement;

const TITLES = Object.freeze({
  '/ranges': 'Poker Lab · Range Explorer',
  '/tournament': 'Poker Lab · Tournament Manager',
  '/hands': 'Poker Lab · Hand Logger'
});

/** The id in `/hands/:id`, or `null` for the index route. */
const HANDS_PREFIX = '/hands/';

/** @param {string} path @returns {string|null} */
function handIdFrom(path) {
  if (!path.startsWith(HANDS_PREFIX)) return null;
  const id = path.slice(HANDS_PREFIX.length);
  return id.length > 0 ? decodeURIComponent(id) : null;
}

/** @param {string} path @returns {string} */
function titleFor(path) {
  if (handIdFrom(path)) return 'Poker Lab · Hand';
  return TITLES[path] || 'Poker Lab · Odds Calculator';
}

/** @param {string} path @returns {*} the page component for that route */
function pageFor(path) {
  if (path === '/ranges') return e(RangeExplorerPage);
  if (path === '/tournament') return e(TournamentManagerPage);

  const handId = handIdFrom(path);
  if (handId) return e(HandDetailPage, { id: handId });
  if (path === '/hands') return e(HandLoggerPage);

  return e(OddsCalculatorPage);
}

export function AppShell() {
  const path = useRoute();
  const isWide = path === '/ranges' || path === '/tournament' || path.startsWith('/hands');

  React.useEffect(() => {
    document.title = titleFor(path);
  }, [path]);

  return e(
    React.Fragment,
    null,
    e('header', { className: 'site-header' }, e(Nav, { path })),
    e(
      'main',
      { className: 'site-content' },
      e('div', { className: `page-shell ${isWide ? 'is-wide' : ''}` }, pageFor(path))
    ),
    e(
      'footer',
      { className: 'site-footer' },
      e('p', { className: 'small' }, 'Poker Lab — a portfolio poker toolkit.')
    )
  );
}
