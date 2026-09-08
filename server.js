/**
 * Vercel's entry point -- not the one used for local development.
 *
 * Vercel's zero-config Express hosting recognizes two patterns: a default
 * export of the app itself, or a call to app.listen(). The first version of
 * this file used the default-export pattern with a top-level await
 * (`const app = await createApp(); export default app;`) -- and the
 * deployed function was never built at all: the deployment succeeded, but
 * showed zero invocations for every request, meaning detection itself
 * silently failed rather than the app failing to run once deployed.
 *
 * Top-level await is a documented rough edge in more than one JS-framework
 * Vercel integration (Astro's Vercel adapter has hit a hard build error over
 * it; SvelteKit's adapter avoids it specifically because of a Vercel
 * incompatibility) -- not proof this exact detection path has the same
 * issue, but the best available lead, and worth removing regardless since
 * `export default` has no way to express "wait for this async value" other
 * than await at module scope. `app.listen()` doesn't have that constraint --
 * it's just a method call, and a method call can live inside a `.then()`
 * with no top-level await anywhere in the file.
 *
 * Nothing about createApp() or its async repository construction changes --
 * only how this one file waits for it.
 */

import { createApp } from './src/server/app.js';

createApp().then(app => {
  app.listen(process.env.PORT || 3000);
});
