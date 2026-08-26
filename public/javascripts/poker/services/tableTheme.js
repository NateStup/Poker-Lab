/**
 * Which felt the viewer wants to look at.
 *
 * A viewer preference, not a property of the hand: two people opening the same
 * shared link each see their own table, and nothing about the record changes.
 * It is stored accordingly -- one `localStorage` key, read and written behind a
 * try/catch, with a disabled store treated as "use the default" rather than as
 * an error.
 *
 * **The colours are not here.** This module holds ids and display names; the
 * stylesheet holds every gradient, under `[data-table-theme='...']` selectors.
 * That is the same division `PokerTable.js` already draws between geometry and
 * paint, applied the other way round: the component owns where things sit, the
 * stylesheet owns what they look like. Keeping a hex value in both files is
 * the drift this codebase has a lesson about.
 *
 * **The theme is applied to the document, not passed as a prop.** Custom
 * properties inherit, so one attribute on `<html>` reaches every felt on the
 * page -- the replay's, the editor's, and any table added later -- with no
 * component subscribing to anything and no change to `PokerTable` at all. A
 * `theme` prop would mean three call sites each reading this preference and
 * each watching it for changes, which is a subscription system built to move
 * one string.
 */

const STORAGE_KEY = 'pokerLab.tableTheme';

/**
 * The felts on offer.
 *
 * `emerald` is first and is the default, and its gradients in the stylesheet
 * are the exact ones the table shipped with -- so a viewer who never opens the
 * picker sees no change at all. A new theme is an entry here plus a block in
 * `style.css`; nothing else knows how many there are.
 *
 * @type {ReadonlyArray<{id: string, name: string}>}
 */
export const TABLE_THEMES = Object.freeze([
  Object.freeze({ id: 'emerald', name: 'Emerald' }),
  Object.freeze({ id: 'sapphire', name: 'Sapphire' }),
  Object.freeze({ id: 'burgundy', name: 'Burgundy' }),
  Object.freeze({ id: 'graphite', name: 'Graphite' })
]);

/** @type {string} */
export const DEFAULT_TABLE_THEME = TABLE_THEMES[0].id;

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function isKnownTheme(id) {
  return TABLE_THEMES.some(theme => theme.id === id);
}

/**
 * The stored preference, or the default.
 *
 * A stored value is validated against the list rather than trusted, because
 * the store outlives the code: a theme removed in a later version leaves its
 * id sitting in browsers that used it, and writing that straight onto the
 * document paints a table with no gradients defined for it -- a felt with no
 * background at all, which is worse than the wrong colour.
 *
 * @returns {string} a theme id that is definitely in {@link TABLE_THEMES}
 */
export function getTableTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isKnownTheme(stored) ? stored : DEFAULT_TABLE_THEME;
  } catch {
    // Private browsing or a disabled store. The table still has a felt.
    return DEFAULT_TABLE_THEME;
  }
}

/**
 * Put a theme on the document, which is what actually changes the colour of
 * every table on the page.
 *
 * @param {string} id
 */
function applyTheme(id) {
  document.documentElement.dataset.tableTheme = isKnownTheme(id) ? id : DEFAULT_TABLE_THEME;
}

/**
 * Choose a theme: remember it, and paint it.
 *
 * The write is attempted first but its failure is not allowed to stop the
 * paint -- a viewer with storage disabled still gets the felt they clicked on
 * for the rest of the page view, they just get the default again next visit.
 *
 * @param {string} id
 */
export function setTableTheme(id) {
  const theme = isKnownTheme(id) ? id : DEFAULT_TABLE_THEME;

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Nothing to do: the choice still holds for this page view.
  }

  applyTheme(theme);
}

/**
 * Paint the stored preference. Called once from the bootstrap, before React
 * mounts, so the first table rendered is already the right colour rather than
 * flashing the default and correcting itself.
 */
export function applyStoredTableTheme() {
  applyTheme(getTableTheme());
}
