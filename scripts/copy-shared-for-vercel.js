#!/usr/bin/env node
/**
 * Vercel-only build step: copies src/shared/ into public/shared/.
 *
 * This project has no build step for local development -- the browser
 * imports src/shared/ files directly, reached at runtime via an
 * express.static() mount at /shared. Vercel's zero-config Express hosting
 * ignores express.static() entirely: anything the browser needs has to
 * already live under public/**, which Vercel serves via its own CDN. This
 * script is the one place that gap gets closed -- a plain, unbundled file
 * copy, run only during Vercel's own build phase, so local dev stays exactly
 * as buildless as it's always been. Nothing is transformed, minified, or
 * bundled; the files that land in public/shared/ are byte-identical to
 * src/shared/.
 *
 * public/shared/ is committed -- it's the real copy Vercel serves in
 * production. A generated file Vercel's own build produces under public/
 * isn't reliably included in what it actually serves, so this script's
 * output can't be left to build time alone. It still runs as part of
 * `vercel-build` too, as a defensive re-sync in case the committed copy is
 * ever stale, but committing it is what actually makes /shared/*.js
 * reachable in production. Re-run this manually after any change to
 * src/shared/ and commit the result; test/publicSharedSync.test.js fails
 * loudly if that step is forgotten.
 */

import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', 'src', 'shared');
const destination = path.join(here, '..', 'public', 'shared');

// Clean first rather than merge -- a file deleted from src/shared/ since the
// last deploy should disappear from public/shared/ too, not linger.
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

console.log(`[vercel-build] copied ${source} -> ${destination}`);
