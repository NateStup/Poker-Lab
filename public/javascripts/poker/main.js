/**
 * Browser entry point.
 *
 * React and ReactDOM are loaded as UMD globals from a CDN in `index.html`, so
 * this module waits for nothing and simply mounts. Keeping the bootstrap
 * separate from {@link PokerApp} means the component tree stays importable by
 * anything that wants to render it elsewhere (a future tracker page, a test
 * harness) without triggering a mount as a side effect.
 */

import { PokerApp } from './PokerApp.js';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing #root element; cannot mount the application.');
}

ReactDOM.createRoot(container).render(React.createElement(PokerApp));
