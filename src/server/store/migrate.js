/**
 * A minimal migration runner.
 *
 * Every `.sql` file in `migrations/`, named `NNNN_description.sql`, is one
 * migration. Applied ones are recorded in `schema_migrations` by filename, so
 * running this twice is safe -- only files that haven't run yet execute, in
 * filename order. There is no "down" migration and no framework: a table of
 * applied filenames is the whole feature a heavier tool would add here, and
 * everything past that (rollback, migrations branching across branches) is a
 * problem multiple contributors working in parallel have, which this project
 * doesn't.
 *
 * Deliberately not run automatically on server start: a schema change is a
 * deploy step, not a side effect of the app booting. Running it on every
 * `npm run dev` restart would mean a broken migration gets silently retried
 * on every file save instead of failing once, visibly, when it's applied.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT_DIR } from '../config.js';
import { getPool } from './postgres/pool.js';

const MIGRATIONS_DIR = path.join(ROOT_DIR, 'migrations');

/**
 * Apply every migration that hasn't run yet.
 * @returns {Promise<{applied: string[]}>} filenames actually run, oldest first
 */
export async function migrate() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter(name => name.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(row => row.name));

  const toApply = files.filter(name => !applied.has(name));
  const ran = [];

  for (const name of toApply) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      ran.push(name);
      console.log(`[migrate] applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  if (ran.length === 0) console.log('[migrate] nothing to apply');
  return { applied: ran };
}

// Runnable directly: `node src/server/store/migrate.js`, or via `npm run db:migrate`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = getPool();
  migrate()
    .then(() => pool.end())
    .catch(error => {
      console.error(error);
      pool.end().finally(() => process.exit(1));
    });
}
