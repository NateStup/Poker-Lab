/**
 * Minimal path-based client router.
 *
 * The project deliberately minimises dependencies (see CLAUDE.md), and the
 * app only needs a handful of routes, so a small hand-rolled router beats
 * pulling in react-router. The server already falls through every non-API path to
 * `index.html` (see `app.js`), which is what lets a deep link or hard refresh
 * on `/ranges` work with no server-side route table at all.
 */

const listeners = new Set();

/**
 * Where a navigation lands is this app's decision, not the browser's.
 *
 * Left on the default (`'auto'`), the browser restores the previous entry's
 * scroll offset on a back/forward against a document React has not re-rendered
 * yet, so the app has to own the scroll on every path change -- see `notify`
 * for the part that actually matters.
 */
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

/**
 * Navigate to a new path, pushing a history entry and notifying every
 * `useRoute` subscriber.
 * @param {string} path
 */
export function navigate(path) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  pushedEntries += 1;
  notify();
}

/**
 * Publish the new path -- but scroll to the top *first*, before any subscriber
 * re-renders.
 *
 * The order is the whole point, and getting it backwards is a real bug this
 * app shipped. Leaving a tall page while scrolled down, the sequence used to
 * be: React commits the short page, the document collapses under a scroll
 * offset that is now past its end, the browser clamps the offset back to zero,
 * and a band of the page that just went away is left painted below the new one
 * -- the hand replayer's felt showing under a page whose shell is 300px
 * narrower than the felt is wide. Scrolling after the commit cannot fix that:
 * by then the clamp has already happened, and `scrollTo(0, 0)` at an offset of
 * zero is a no-op that invalidates nothing.
 *
 * Scrolling here instead means the document only ever shrinks while the
 * viewport is already at the top, so there is no offset left to clamp. It
 * belongs in this module rather than in a component effect for the same reason
 * `useSearchParam` does: one reader and one writer of `window.location` and
 * the history, and no page has to remember to do it.
 */
function notify() {
  const path = window.location.pathname;
  window.scrollTo(0, 0);
  for (const listener of listeners) listener(path);
}

/**
 * How many navigations this app has pushed onto the history stack. A shared
 * link opened cold starts at zero, and calling `history.back()` there would
 * leave the app entirely -- so `goBack` needs to know the difference between
 * "somewhere to return to" and "this is where the user arrived".
 */
let pushedEntries = 0;

/**
 * Return to wherever the user came from.
 *
 * @param {string} [fallback] where to go when there is no in-app history to
 *   pop -- the case that matters is a shared hand opened in a fresh tab
 * @returns {void}
 */
export function goBack(fallback = '/') {
  if (pushedEntries > 0) {
    // popstate fires on its own and notifies subscribers; the counter is
    // decremented there so a browser-button back stays in step too.
    window.history.back();
    return;
  }
  navigate(fallback);
}

window.addEventListener('popstate', () => {
  pushedEntries = Math.max(0, pushedEntries - 1);
  notify();
});

/**
 * Subscribe to the current pathname. The calling component re-renders on
 * every navigation, including browser back/forward.
 * @returns {string} `location.pathname`
 */
export function useRoute() {
  const [path, setPath] = React.useState(window.location.pathname);

  React.useEffect(() => {
    listeners.add(setPath);
    return () => listeners.delete(setPath);
  }, []);

  return path;
}

/**
 * Read one query-string parameter, re-reading it on every navigation.
 *
 * Query handling lives here rather than in the page that wants it so there is
 * still exactly one module that touches `window.location` -- the login
 * redirect's `?next=` (read by `useAuthRedirectTarget` in
 * `context/AuthContext.js`, written by `RequireAuth` when it turns someone
 * away) is what needs a parameter, and it shouldn't be the reason a page
 * starts reaching for the URL itself.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function useSearchParam(name) {
  const read = React.useCallback(() => new URLSearchParams(window.location.search).get(name), [name]);
  const [value, setValue] = React.useState(read);

  React.useEffect(() => {
    const listener = () => setValue(read());
    listener();
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [read]);

  return value;
}

const e = React.createElement;

/**
 * A client-routed link. Behaves like a plain `<a>` for the cases that should
 * bypass routing entirely -- middle click, ctrl/cmd/shift/alt click, right
 * click -- so "open in new tab" still works; a plain left click is
 * intercepted to navigate without a full page reload.
 * @param {{to: string, children: *, [key: string]: *}} props
 */
export function Link({ to, children, ...rest }) {
  return e(
    'a',
    {
      ...rest,
      href: to,
      onClick(event) {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }
    },
    children
  );
}
