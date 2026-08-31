/**
 * The Poker Lab mark.
 *
 * Drawn as an SVG path rather than set as the `♠` character, for the same
 * reason the playing cards carry a text-presentation selector: a suit
 * character is one font substitution away from rendering as a colour emoji,
 * and a logo that changes shape depending on the machine isn't a logo. A path
 * also scales cleanly from the 1rem mark in the header to the one sitting
 * across a poker table.
 *
 * One definition, both placements -- the header wordmark and the felt.
 */

const e = React.createElement;

/** The spade outline, in a 24x24 box. */
const SPADE_PATH = 'M12 2.5c0 0-7.2 6.2-7.2 10.7a4.1 4.1 0 0 0 6.6 3.3c-.2 1.9-1 3.4-2.6 5h6.4c-1.6-1.6-2.4-3.1-2.6-5a4.1 4.1 0 0 0 6.6-3.3C19.2 8.7 12 2.5 12 2.5z';

/**
 * @param {object} props
 * @param {number|string} [props.size] any CSS length; a number is treated as px
 * @param {string} [props.className]
 */
export function SpadeMark({ size = 18, className = '' }) {
  return e(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      className: `spade-mark ${className}`.trim(),
      'aria-hidden': 'true',
      focusable: 'false'
    },
    e('path', { d: SPADE_PATH, fill: 'currentColor' })
  );
}

/**
 * The mark and the wordmark stacked, as they appear stitched into the middle
 * of the felt. Decorative only -- the table's information (board, pot) sits on
 * top of it, so this is `aria-hidden` and must never be the only place
 * something is said.
 */
export function TableLogo() {
  return e(
    'div',
    { className: 'poker-table-logo', 'aria-hidden': 'true' },
    e(SpadeMark, { size: '2.6rem' }),
    e('span', { className: 'poker-table-logo-word' }, 'Poker Lab')
  );
}
