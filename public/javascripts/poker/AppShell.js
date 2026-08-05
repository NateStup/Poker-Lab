/**
 * Root component: the page shell (header/nav/footer) every page shares, plus
 * the route switch that decides which page renders inside it.
 *
 * Kept deliberately dumb -- two routes, no nesting, no route params -- because
 * that is genuinely all this app needs. See `router.js` for why that means no
 * router dependency either.
 */

import { Nav } from './components/Nav.js';
import { EquityCalculatorPage } from './pages/EquityCalculatorPage.js';
import { RangeExplorerPage } from './pages/RangeExplorerPage.js';
import { useRoute } from './router.js';

const e = React.createElement;

/** @param {string} path @returns {string} */
function titleFor(path) {
  return path === '/ranges' ? 'Poker Lab · Range Explorer' : 'Poker Lab · Equity Calculator';
}

export function AppShell() {
  const path = useRoute();
  const isRangeExplorer = path === '/ranges';

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
      e(
        'div',
        { className: `page-shell ${isRangeExplorer ? 'is-wide' : ''}` },
        isRangeExplorer ? e(RangeExplorerPage) : e(EquityCalculatorPage)
      )
    ),
    e(
      'footer',
      { className: 'site-footer' },
      e('p', { className: 'small' }, 'Poker Lab — a portfolio poker toolkit.')
    )
  );
}
