/**
 * Vercel's entry point -- not the one used for local development.
 *
 * Vercel's zero-config Express hosting looks for a file at one of a fixed
 * set of conventional paths (app.js, index.js, or server.js, at the project
 * root or directly under src/) exporting the Express app as a default
 * export. This project's real entry point, src/server/server.js, sits one
 * folder deeper than any of those -- so it was never going to be found, and
 * this file exists purely to give Vercel something at a path it actually
 * checks. `npm start` / `npm run dev` are completely untouched by this file
 * and keep using src/server/server.js exactly as they always have.
 *
 * createApp() already returns a fully-assembled app with no port bound --
 * that split (assembly here, binding a port in server.js) was made for
 * testability, so api.test.js could boot the real app against an ephemeral
 * port. It turns out to be exactly what a serverless host wants too:
 * something already built, with nothing left to do but hand it requests.
 *
 * Top-level await is what lets this stay a plain default export rather than
 * a promise Vercel would have to know to unwrap -- the async work (building
 * every repository) happens once, when this module is first loaded, and
 * Fluid compute's warm reuse means that's the common case, not "every
 * request."
 */

import { createApp } from './src/server/app.js';

const app = await createApp();

export default app;
