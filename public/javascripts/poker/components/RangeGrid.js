/**
 * The 13x13 starting-hand range grid.
 *
 * Supports click-to-toggle and press-and-drag "painting" (the interaction
 * every range tool uses): the state of the first cell touched decides whether
 * the drag selects or deselects, and every cell the pointer crosses while
 * held down is set to match. No `pointercapture` is taken, so the browser
 * keeps delivering `pointerenter` to whichever sibling button the cursor
 * actually moves over -- that's what makes the drag work across cells at all.
 */

import { RANGE_GRID } from '/shared/poker/ranges.js';

const e = React.createElement;

const CELLS = RANGE_GRID.flat();

/**
 * @param {object} props
 * @param {Set<string>} props.selected hand codes currently in the range
 * @param {(next: Set<string>) => void} props.onChange
 * @param {'hero'|'villain'} [props.role='hero'] controls the selected-cell color
 * @param {Set<string>} [props.disabledHands] hand codes that can't be toggled
 *   (e.g. blocked entirely by the board/dead cards)
 */
export function RangeGrid({ selected, onChange, role = 'hero', disabledHands }) {
  // Tracks an in-progress drag: whether it is painting cells on or off.
  const paintingRef = React.useRef(null);
  const disabled = disabledHands || EMPTY_SET;

  React.useEffect(() => {
    function stopPainting() {
      paintingRef.current = null;
    }
    window.addEventListener('pointerup', stopPainting);
    return () => window.removeEventListener('pointerup', stopPainting);
  }, []);

  function setHand(hand, isSelected) {
    if (disabled.has(hand)) return;
    const next = new Set(selected);
    if (isSelected) next.add(hand); else next.delete(hand);
    onChange(next);
  }

  function handlePointerDown(event, hand) {
    if (event.button !== 0 || disabled.has(hand)) return;
    const willSelect = !selected.has(hand);
    paintingRef.current = willSelect;
    setHand(hand, willSelect);
  }

  function handlePointerEnter(hand) {
    if (paintingRef.current === null) return;
    setHand(hand, paintingRef.current);
  }

  return e(
    'div',
    { className: 'range-grid', role: 'grid', 'aria-label': `${role === 'hero' ? 'Hero' : 'Villain'} range grid` },
    CELLS.map(cell => {
      const isSelected = selected.has(cell.hand);
      return e('button', {
        key: cell.hand,
        type: 'button',
        className: [
          'range-cell',
          `type-${cell.type}`,
          isSelected ? 'is-selected' : '',
          isSelected && role === 'villain' ? 'role-villain' : ''
        ].filter(Boolean).join(' '),
        disabled: disabled.has(cell.hand),
        'aria-pressed': isSelected,
        title: cell.hand,
        onPointerDown: event => handlePointerDown(event, cell.hand),
        onPointerEnter: () => handlePointerEnter(cell.hand)
      }, cell.hand);
    })
  );
}

const EMPTY_SET = new Set();
