/**
 * router.js tests -- goBack/navigate's history-depth tracking, without a
 * browser.
 *
 * router.js needs `window` to exist at import time (every exported function
 * reads `window.history`/`window.location` live, and the module touches
 * `window.history.scrollRestoration` once at load, plus `React.createElement`
 * once for `Link`'s definition), so it can't be imported the plain way
 * `boardSlots.js` is, with no DOM at all. What it doesn't need is a *real*
 * DOM: nothing exercised here touches an element, a style, or a render --
 * only the History API's own shape (`pushState`, `state`, `back`, `forward`,
 * a `popstate` listener). A hand-rolled fake of just that shape, following
 * the same session-history contract a real browser keeps (one linear stack,
 * a current index, `pushState` truncating anything ahead of it), is enough
 * to drive the real module against it -- not a reimplementation of its
 * logic, `router.js` itself, run against a fake it can't tell from the
 * genuine article.
 *
 * Each test imports a fresh copy of the module against its own fresh window,
 * via a cache-busting query string on the import specifier -- matching what
 * a real page load actually is (one `window`, one evaluation of the module,
 * for the lifetime of that page), rather than one shared module instance
 * having its `window` swapped out from under it between unrelated tests. That
 * distinction matters here specifically: the bug this file exists to catch
 * was a module-level counter, and testing the pre-fix code against a shared
 * module instance whose `window` changes between tests would leak that
 * counter across tests that have nothing to do with each other, which is not
 * the shape of the actual bug (a single page's session hitting back then
 * forward) and would make failures at the wrong tests than the real one.
 *
 * Deliberately not tested here: `useRoute`, `useSearchParam`, and `Link`,
 * all of which call into React, and `notify`'s scroll-to-top and listener
 * fan-out. This project has no test infrastructure for React components
 * (see CLAUDE.md) and none of that is what was actually buggy. What's
 * covered is the one thing that was: whether `goBack` can tell a `popstate`
 * caused by going *back* apart from one caused by going *forward* -- which a
 * real browser's own `history.state` already knows, and a separately
 * maintained counter never could, because `popstate` fires identically
 * either way.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * A minimal stand-in for `window`, modelling exactly the slice of the
 * History API `router.js` touches: one linear list of entries with a
 * current index, `pushState` truncating anything ahead of it (as a real
 * browser does the moment a new entry is pushed from a page back in the
 * stack), and `back`/`forward` moving the index and firing `popstate`
 * synchronously. A real browser dispatches `popstate` as a separate task;
 * synchronous is simpler here and just as honest for exercising this
 * module's own branching, which is the only thing under test.
 * @param {string} initialPath
 */
function createFakeWindow(initialPath) {
  const entries = [{ state: null, path: initialPath }];
  let index = 0;
  const popstateListeners = new Set();

  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state, _title, path) {
      entries.length = index + 1;
      entries.push({ state, path });
      index = entries.length - 1;
    },
    back() {
      if (index === 0) return;
      index -= 1;
      for (const listener of popstateListeners) listener({ state: history.state });
    },
    forward() {
      if (index === entries.length - 1) return;
      index += 1;
      for (const listener of popstateListeners) listener({ state: history.state });
    }
  };

  return {
    history,
    location: {
      get pathname() {
        return entries[index].path;
      }
    },
    scrollTo() {},
    addEventListener(type, listener) {
      if (type === 'popstate') popstateListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'popstate') popstateListeners.delete(listener);
    }
  };
}

let importCounter = 0;

/**
 * A fresh `window` plus a fresh copy of `router.js` imported against it --
 * one page load, modelled honestly, for one test.
 * @returns {Promise<{window: object, router: typeof import('../../public/javascripts/poker/router.js')}>}
 */
async function freshPageLoad() {
  const fakeWindow = createFakeWindow('/');
  globalThis.window = fakeWindow;
  globalThis.React = { createElement: () => null };

  importCounter += 1;
  const router = await import(`../../public/javascripts/poker/router.js?fresh=${importCounter}`);
  return { window: fakeWindow, router };
}

describe('router history-depth tracking', () => {
  it('a cold-opened page has no history to pop', async () => {
    const { window } = await freshPageLoad();
    assert.equal(window.history.state, null);
  });

  it('navigate stamps an increasing depth into each entry it pushes', async () => {
    const { window, router } = await freshPageLoad();

    router.navigate('/ranges');
    assert.equal(window.history.state.depth, 1);
    assert.equal(window.location.pathname, '/ranges');

    router.navigate('/tournament');
    assert.equal(window.history.state.depth, 2);
  });

  it('goBack falls back when there is nothing real to pop', async () => {
    const { window, router } = await freshPageLoad();

    router.goBack('/fallback');
    assert.equal(window.location.pathname, '/fallback');
  });

  it('goBack uses real back-navigation once something has been pushed', async () => {
    const { window, router } = await freshPageLoad();

    router.navigate('/ranges');
    router.goBack('/fallback');
    assert.equal(window.location.pathname, '/', 'popped the real entry, not the fallback');
  });

  // The bug itself, reproduced: a counter that only decrements on `popstate`
  // can't tell a *forward* navigation apart from a *back* one, since the
  // browser fires the identical event for both. Reading `history.state`
  // instead can, because the browser hands back the entry's own state either
  // way -- this is the repro from the handoff (open cold, navigate, back,
  // forward), reproduced here without a browser and confirmed separately in
  // one, in a real Chrome via playwright-core (see the PR description).
  it('survives a back navigation followed by a forward navigation', async () => {
    const { window, router } = await freshPageLoad();

    router.navigate('/ranges');
    window.history.back();
    assert.equal(window.location.pathname, '/', 'sanity check: real back landed on the cold entry');

    window.history.forward();
    assert.equal(window.location.pathname, '/ranges', 'sanity check: real forward restored the pushed entry');
    assert.equal(window.history.state.depth, 1, "the pushed entry's own state survives the round trip");

    router.goBack('/fallback');
    assert.equal(
      window.location.pathname,
      '/',
      'goBack must use real history.back() here -- a counter-based implementation clamped at ' +
        'zero after the back navigation and never recovered on forward, so it fell back to ' +
        '/fallback even though real history was still there to pop'
    );
  });

  it('survives two back/forward round trips in a row, not just the first', async () => {
    const { window, router } = await freshPageLoad();

    router.navigate('/ranges');
    window.history.back();
    window.history.forward();
    router.goBack('/fallback');
    assert.equal(window.location.pathname, '/', 'first round trip');

    window.history.forward();
    assert.equal(window.history.state.depth, 1, 'sanity check before the second round trip');
    router.goBack('/fallback');
    assert.equal(window.location.pathname, '/', 'second round trip');
  });
});
