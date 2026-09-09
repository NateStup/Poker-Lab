/**
 * Which tournaments this browser created without an account.
 *
 * This is a revived version of `handOwnership.js`, deleted when hands went
 * fully authenticated -- but tournaments are a different case, not a
 * regression back to the old one. Anonymous ownership is a real, permanently
 * supported mode here (a tournament needs no account at all), not a stopgap
 * on the way to every tournament having a real owner. The same soft-tracking
 * shape earns its place back for exactly that reason.
 *
 * It is deliberately **not** access control -- the server has no notion of
 * "this browser," and anyone can clear this list. It decides what a page
 * offers (which controls to show), not what the server permits, and it is
 * not a substitute for the real ownership a `save()` call establishes:
 * once a tournament has a `userId`, this list has nothing left to say about
 * it, because the server already enforces the real rule regardless of what
 * this shows.
 */

const STORAGE_KEY = 'pokerLab.myTournaments';

/**
 * @returns {string[]} tournament ids created from this browser, oldest first
 */
function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    // Private browsing, a disabled store, or a value someone else wrote --
    // none of which should stop a tournament from being read.
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
    // Nothing to do: the page still works, the browser just won't be
    // recognised as this tournament's creator on its next visit.
  }
}

/**
 * Record that this browser created a tournament.
 * @param {string} id
 */
export function rememberTournament(id) {
  const ids = read();
  if (!ids.includes(id)) write([...ids, id]);
}

/**
 * @param {string} id
 * @returns {boolean} whether this browser created the tournament
 */
export function isMyTournament(id) {
  return read().includes(id);
}

/**
 * Drop a tournament from the list -- called after a delete, or after
 * discovering the id no longer answers to this browser (someone else's
 * account claimed it), so it doesn't sit there forever pointing at
 * something this browser can no longer reach.
 * @param {string} id
 */
export function forgetTournament(id) {
  const ids = read();
  if (ids.includes(id)) write(ids.filter(existing => existing !== id));
}

/**
 * Every tournament id this browser has created, oldest first.
 *
 * The one addition beyond `handOwnership.js`'s shape, and it earns its place
 * for a reason unique to tournaments: hands always had a server-side list to
 * filter locally (even pre-accounts, the old `/api/hands` was fully public).
 * An anonymous caller here has no list endpoint at all any more -- `GET
 * /api/tournaments` now requires a session -- so without this, a tournament
 * created while logged out would have no way back once the page reloads and
 * its in-memory state is gone. `GET /api/tournaments/:id` stays open to
 * anyone for an unowned tournament, so the landing view uses this to know
 * which ids are worth asking about.
 * @returns {string[]}
 */
export function listRememberedTournaments() {
  return read();
}
