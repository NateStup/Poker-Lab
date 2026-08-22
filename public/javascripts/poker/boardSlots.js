/**
 * The rule that keeps a board's streets dealable as cards are cleared.
 *
 * The Odds Calculator and the Range Explorer both model the board as three
 * fixed-size arrays with `null` holes (`{flop: [3], turn: [1], river: [1]}`)
 * and both flatten it with `.filter(Boolean)` before sending it to the API.
 * That flatten is why clearing a card cannot be a purely local edit: a flop
 * plus turn plus river with the *turn* cleared flattens to four cards, and
 * four cards is a perfectly valid board -- so the river would be silently
 * re-read as the turn and the answer would come back wrong rather than
 * refused. Wrong-but-plausible is the worst outcome available here.
 *
 * So clearing a card also clears every *later* street, which is just how a
 * hand runs: there is no river without a turn, and no turn without a flop.
 * Sibling cards within one street are left alone -- the three flop cards are
 * dealt at once, so removing one leaves an incomplete flop the user is
 * presumably mid-edit on, and an incomplete board trips the street-boundary
 * check and gets a real message instead of being mis-read.
 *
 * This lives in its own module rather than in either page because both pages
 * need the identical rule, and one correctness rule kept in two places is
 * exactly the drift this codebase already has a hard-won lesson about (see
 * CLAUDE.md on the two hand evaluators that disagreed).
 */

/** Board streets, in the order they are dealt. */
export const BOARD_STREETS = Object.freeze(['flop', 'turn', 'river']);

/**
 * Clear one board card, and with it every street dealt after that card's.
 *
 * @param {{flop: (string|null)[], turn: (string|null)[], river: (string|null)[]}} streets
 *   the current board; any other properties on the object are ignored, which
 *   is what lets a page whose state holds the streets alongside other fields
 *   pass that state straight in
 * @param {string} street `'flop'`, `'turn'` or `'river'`
 * @param {number} index the position of the card within that street
 * @returns {{flop: (string|null)[], turn: (string|null)[], river: (string|null)[]}}
 *   all three streets, for the caller to spread into its own state shape
 */
export function clearBoardCard(streets, street, index) {
  const clearedFrom = BOARD_STREETS.indexOf(street);
  // Guard rather than trust: an unrecognised street would otherwise compare
  // greater than -1 for every position and silently wipe the whole board.
  if (clearedFrom === -1) return { flop: streets.flop, turn: streets.turn, river: streets.river };

  const next = {};
  BOARD_STREETS.forEach((name, position) => {
    if (position < clearedFrom) {
      next[name] = streets[name];
    } else if (position > clearedFrom) {
      next[name] = streets[name].map(() => null);
    } else {
      next[name] = streets[name].map((card, cardIndex) => (cardIndex === index ? null : card));
    }
  });
  return next;
}
