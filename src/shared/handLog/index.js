/**
 * Public surface of the shared hand-log domain. Mirrors `shared/poker/` and
 * `shared/tournament/`: pure, dependency-free, imported by both the server
 * and the browser (the browser reaches it at `/shared/handLog/index.js`).
 *
 * This is the first shared module to build on another one -- it imports card
 * helpers and the table-size bounds from `shared/poker/`. That's fine and
 * deliberate: both are pure, and a hand log genuinely is cards plus betting,
 * so duplicating `normalizeCard` here would recreate exactly the kind of
 * split this directory exists to prevent.
 */

export * from './actions.js';
export * from './positions.js';
export * from './validation.js';
