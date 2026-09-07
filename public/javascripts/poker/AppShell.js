/**
 * Root component: the page shell (header/nav/footer) every page shares, plus
 * the route switch that decides which page renders inside it.
 *
 * Still no router dependency -- see `router.js`. Auth state is mounted here
 * too, alongside routing -- both are cross-cutting concerns every page can
 * need, not something any individual page should have to reach for on its
 * own. `RequireAuth` wraps the two routes that need a session, right here at
 * the route table, rather than each of those pages checking for itself --
 * one place decides which routes are protected, the same way one place
 * (`TITLES`, `pageFor`) already decides what each route renders.
 */

import { Nav } from './components/Nav.js';
import { AuthProvider, RequireAuth } from './context/AuthContext.js';
import { AuthPage } from './pages/AuthPage.js';
import { HandDetailPage } from './pages/HandDetailPage.js';
import { HandLoggerPage } from './pages/HandLoggerPage.js';
import { OddsCalculatorPage } from './pages/OddsCalculatorPage.js';
import { RangeExplorerPage } from './pages/RangeExplorerPage.js';
import { SharedHandPage } from './pages/SharedHandPage.js';
import { TournamentManagerPage } from './pages/TournamentManagerPage.js';
import { useRoute } from './router.js';

const e = React.createElement;

const TITLES = Object.freeze({
  '/ranges': 'Poker Lab · Range Explorer',
  '/tournament': 'Poker Lab · Tournament Manager',
  '/hands': 'Poker Lab · Hand Logger',
  '/login': 'Poker Lab · Log in',
  '/signup': 'Poker Lab · Sign up'
});

/** The id in `/hands/:id`. */
const HANDS_PREFIX = '/hands/';
/** The token in `/shared/:token`. */
const SHARED_PREFIX = '/shared/';

/**
 * Both prefixed routes need the same "strip the prefix, decode what's left,
 * treat an empty result as none" rule -- one function for it rather than
 * `/hands/:id` and `/shared/:token` each growing their own slightly
 * different copy.
 * @param {string} path @param {string} prefix @returns {string|null}
 */
function segmentAfter(path, prefix) {
  if (!path.startsWith(prefix)) return null;
  const value = path.slice(prefix.length);
  return value.length > 0 ? decodeURIComponent(value) : null;
}

/** @param {string} path @returns {string} */
function titleFor(path) {
  if (segmentAfter(path, HANDS_PREFIX)) return 'Poker Lab · Hand';
  if (segmentAfter(path, SHARED_PREFIX)) return 'Poker Lab · Shared hand';
  return TITLES[path] || 'Poker Lab · Odds Calculator';
}

/** @param {string} path @returns {*} the page component for that route */
function pageFor(path) {
  if (path === '/ranges') return e(RangeExplorerPage);
  if (path === '/tournament') return e(TournamentManagerPage);
  if (path === '/login') return e(AuthPage, { mode: 'login' });
  if (path === '/signup') return e(AuthPage, { mode: 'signup' });

  const sharedToken = segmentAfter(path, SHARED_PREFIX);
  if (sharedToken) return e(SharedHandPage, { token: sharedToken });

  const handId = segmentAfter(path, HANDS_PREFIX);
  if (handId) return e(RequireAuth, { path }, e(HandDetailPage, { id: handId }));
  if (path === '/hands') return e(RequireAuth, { path }, e(HandLoggerPage));

  return e(OddsCalculatorPage);
}

export function AppShell() {
  const path = useRoute();
  const isWide =
    path === '/ranges' || path === '/tournament' || path.startsWith('/hands') || path.startsWith(SHARED_PREFIX);

  React.useEffect(() => {
    document.title = titleFor(path);
  }, [path]);

  return e(
    AuthProvider,
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
      e('p', { className: 'small' }, 'Poker Lab — a full-stack poker toolkit, built end to end as a portfolio project.')
    )
  );
}
