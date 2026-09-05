/**
 * Site title, primary navigation, and the account corner -- shared by every
 * page.
 */

import { useAuth } from '../context/AuthContext.js';
import { Link } from '../router.js';
import { SpadeMark } from './Logo.js';

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
  const { status, user, logout } = useAuth();

  return e(
    'div',
    { className: 'site-header-inner' },
    e(
      Link,
      { to: '/', className: 'site-title' },
      e(SpadeMark, { size: '1.1em', className: 'site-title-mark' }),
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
    ),
    // Nothing rendered while the initial /api/auth/me check is in flight --
    // a page-load flash of "Log in" that then swaps to an account name reads
    // as more broken than a briefly empty corner.
    status === 'authenticated'
      ? e(
          'div',
          { className: 'nav-account' },
          e('span', { className: 'small' }, user.displayName),
          e('button', { type: 'button', className: 'ghost-button', onClick: logout }, 'Log out')
        )
      : status === 'anonymous'
        ? e(
            'div',
            { className: 'nav-account' },
            e(Link, { to: '/login', className: 'ghost-button' }, 'Log in'),
            e(Link, { to: '/signup', className: 'ghost-button' }, 'Sign up')
          )
        : null
  );
}
