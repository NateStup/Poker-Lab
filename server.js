/**
 * Vercel's entry point -- not the one used for local development.
 *
 * Vercel's "Express" framework preset does literal static analysis on this
 * file, checking specifically for a direct `import express from 'express'`
 * statement -- confirmed by the exact build error this project hit:
 * "No entrypoint found which imports express. Found possible entrypoint:
 * server.js". Because the real app is assembled by createApp() in a
 * different file, this file never imported express directly, and the
 * detector doesn't trace through that indirection -- it only checks the one
 * file it's considering as the entrypoint.
 *
 * The import below exists for that check alone. `app` itself still comes
 * from createApp(), not from calling express() in this file -- the `express`
 * binding is otherwise unused, and that's expected, not a mistake to clean
 * up. Removing it will silently break detection again with no runtime
 * error, only a build that succeeds while quietly never producing a
 * function -- exactly what happened on the two attempts before this one.
 */
// eslint-disable-next-line no-unused-vars
import express from 'express';

import { createApp } from './src/server/app.js';

createApp().then(app => {
  app.listen(process.env.PORT || 3000);
});
