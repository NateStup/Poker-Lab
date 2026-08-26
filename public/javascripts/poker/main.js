/**
 * Browser entry point.
 *
 * React and ReactDOM are loaded as UMD globals from a CDN in `index.html`, so
 * this module waits for nothing and simply mounts. Keeping the bootstrap
 * separate from {@link AppShell} means the component tree stays importable by
 * anything that wants to render it elsewhere (a test harness) without
 * triggering a mount as a side effect.
 */

import { AppShell } from './AppShell.js';
import { applyStoredTableTheme } from './services/tableTheme.js';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing #root element; cannot mount the application.');
}

// Before the mount, not inside a component: the theme is a data attribute on
// `<html>` that every felt inherits through CSS, so painting it here means the
// first table rendered is already the right colour rather than flashing the
// default and correcting itself a frame later.
applyStoredTableTheme();

ReactDOM.createRoot(container).render(React.createElement(AppShell));
