/**
 * A minimal .env loader.
 *
 * Node's --env-file flag would do this natively, but the "don't error if the
 * file is missing" variant (--env-file-if-exists) needs Node 22.9+, and this
 * project only requires >=20.11.0 -- bumping the engine floor just to make
 * config loading convenient runs backwards. dotenv would do it too, at the
 * cost of a dependency for what is a dozen lines of parsing.
 *
 * Real environment variables always win: a value already in process.env --
 * set by Docker, a hosting platform, or the shell -- is never overwritten by
 * .env, so a deployment's real configuration can never be shadowed by a
 * stray file left in the working directory.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} rootDir directory expected to contain .env
 */
export function loadEnvFile(rootDir) {
  let contents;
  try {
    contents = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
  } catch {
    return; // No .env locally (CI, production) is the normal case, not an error.
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip one layer of matching quotes, the common .env convention.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}
