/**
 * Site title and primary navigation, shared by every page.
 */

import { Link } from '../router.js';

const e = React.createElement;

/** Each entry's `matches` decides the active-link highlight for a given path. */
const NAV_LINKS = Object.freeze([
  { to: '/', label: 'Odds Calculator', matches: path => path === '/' || path === '/equity' || path === '/odds' },
  { to: '/ranges', label: 'Range Explorer', matches: path => path === '/ranges' },
  { to: '/tournament', label: 'Tournament Manager', matches: path => path === '/tournament' },
  { to: '/hands', label: 'Hand Logger', matches: path => path.startsWith('/hands') }
]);

/**
 * @param {{path: string}} props the current `location.pathname`, from `useRoute`
 */
export function Nav({ path }) {
  return e(
    'div',
    { className: 'site-header-inner' },
    e(
      Link,
      { to: '/', className: 'site-title' },
      e('span', { className: 'site-title-mark', 'aria-hidden': 'true' }, '♠'),
      'Poker Lab'
    ),
    e(
      'nav',
      { 'aria-label': 'Primary' },
      e(
        'ul',
        null,
        NAV_LINKS.map(link =>
          e(
            'li',
            { key: link.to },
            e(Link, { to: link.to, 'aria-current': link.matches(path) ? 'page' : undefined }, link.label)
          )
        )
      )
    )
  );
}
