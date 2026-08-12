/**
 * Which saved hands this browser logged.
 *
 * The app has no accounts, so "mine" can only mean "logged from this browser".
 * That is enough for what the Hand Logger needs it for: the author keeps the
 * edit and delete controls on a hand they created, and a link handed to
 * someone else opens as a replay with no editing chrome around it.
 *
 * It is deliberately **not** access control -- the API has no notion of an
 * owner, and anyone who wants to can clear this list or strip the `?share=1`
 * off a URL. It decides what a page offers, not what the server permits. Real
 * per-user hands need real accounts; this is the honest version of the feature
 * until there are any.
 */

const STORAGE_KEY = 'pokerLab.myHands';

/**
 * @returns {string[]} hand ids logged from this browser, oldest first
 */
function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    // Private browsing, a disabled store, or a value someone else wrote --
    // none of which should stop a hand from being read.
    return [];
  }
}

/**
 * @param {string[]} ids
 */
function write(ids) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Nothing to do: the page still works, the author just won't be
    // recognised on their next visit.
  }
}

/**
 * Record that this browser created a hand.
 * @param {string} id
 */
export function rememberHand(id) {
  const ids = read();
  if (!ids.includes(id)) write([...ids, id]);
}

/**
 * @param {string} id
 * @returns {boolean} whether this browser logged the hand
 */
export function isMyHand(id) {
  return read().includes(id);
}

/**
 * Drop a hand from the list -- called after a delete, so the id doesn't sit
 * there forever pointing at something that no longer exists.
 * @param {string} id
 */
export function forgetHand(id) {
  const ids = read();
  if (ids.includes(id)) write(ids.filter(existing => existing !== id));
}
