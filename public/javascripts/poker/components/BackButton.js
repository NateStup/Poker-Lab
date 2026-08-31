/**
 * The return control: one icon, in the same place, on every page that can be
 * arrived at from somewhere else.
 *
 * It replaced a set of differently-worded text buttons ("Back to list", "All
 * hands"), which each named a specific destination and so had to be reworded
 * -- or be wrong -- as soon as a page could be reached from more than one
 * place. An arrow says "back where you were" without claiming to know where
 * that is.
 *
 * The arrow is an inline SVG rather than a character: an arrow glyph is
 * subject to the same emoji-font substitution the suit pips ran into, and a
 * stroked SVG is legible at any size.
 */

import { goBack } from '../router.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {() => void} [props.onClick] override the default history-pop -- for a
 *   view that is "a page" in the user's head but state in the app's (the
 *   Tournament Manager's list, which has no route of its own)
 * @param {string} [props.fallback] where to go when there is no in-app history
 *   to pop, e.g. a shared link opened in a fresh tab
 * @param {string} [props.label] accessible name; also the tooltip
 */
export function BackButton({ onClick, fallback = '/', label = 'Go back' }) {
  return e(
    'button',
    {
      type: 'button',
      className: 'ghost-button icon-button',
      onClick: onClick || (() => goBack(fallback)),
      title: label,
      'aria-label': label
    },
    e(
      'svg',
      { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' },
      e('path', {
        d: 'M11 5 4 12l7 7M4 12h16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      })
    )
  );
}
