/**
 * Root component: the page shell (header/nav/footer) every page shares, plus
 * the route switch that decides which page renders inside it.
 *
 * Kept deliberately dumb -- three routes, no nesting, no route params --
 * because that is genuinely all this app needs. See `router.js` for why that
 * means no router dependency either.
 */

import { Nav } from './components/Nav.js';
import { OddsCalculatorPage } from './pages/OddsCalculatorPage.js';
import { RangeExplorerPage } from './pages/RangeExplorerPage.js';
import { TournamentManagerPage } from './pages/TournamentManagerPage.js';
import { useRoute } from './router.js';

const e = React.createElement;

const TITLES = Object.freeze({
  '/ranges': 'Poker Lab · Range Explorer',
  '/tournament': 'Poker Lab · Tournament Manager'
});

/** @param {string} path @returns {string} */
function titleFor(path) {
  return TITLES[path] || 'Poker Lab · Odds Calculator';
}

/** @param {string} path @returns {*} the page component for that route */
function pageFor(path) {
  if (path === '/ranges') return e(RangeExplorerPage);
  if (path === '/tournament') return e(TournamentManagerPage);
  return e(OddsCalculatorPage);
}

export function AppShell() {
  const path = useRoute();
  const isWide = path === '/ranges' || path === '/tournament';

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
