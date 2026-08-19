/**
 * Minimal path-based client router.
 *
 * The project deliberately minimises dependencies (see CLAUDE.md), and the
 * app only needs two routes, so a small hand-rolled router beats pulling in
 * react-router. The server already falls through every non-API path to
 * `index.html` (see `app.js`), which is what lets a deep link or hard refresh
 * on `/ranges` work with no server-side route table at all.
 */

const listeners = new Set();

/**
 * Navigate to a new path, pushing a history entry and notifying every
 * `useRoute` subscriber.
 * @param {string} path
 */
export function navigate(path) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  notify();
}

function notify() {
  const path = window.location.pathname;
  for (const listener of listeners) listener(path);
}

window.addEventListener('popstate', notify);

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
