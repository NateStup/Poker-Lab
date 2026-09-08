/**
 * Guards the one invariant `scripts/copy-shared-for-vercel.js` exists to
 * uphold: `public/shared/` is a committed, byte-identical copy of
 * `src/shared/`, not something regenerated reliably at deploy time (see that
 * script's header comment for why it has to be committed at all). Without
 * this test, editing `src/shared/` and forgetting to re-run the sync script
 * is a silent production bug -- the browser keeps serving the stale copy
 * from `/shared/*.js` while local dev, which imports `src/shared/` directly,
 * shows the new behaviour. This turns that into a loud `npm test` failure,
 * at the same point every other regression gets caught.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(here, '..', 'src', 'shared');
const COPY_DIR = path.join(here, '..', 'public', 'shared');

/** Recursively lists a directory's files as paths relative to `root`. */
async function listFilesRecursively(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(root, entryPath)));
    } else {
      files.push(path.relative(root, entryPath));
    }
  }
  return files;
}

async function hashFile(filePath) {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

describe('public/shared/ sync with src/shared/', () => {
  it('has exactly the same set of files as src/shared/', async () => {
    const sourceFiles = (await listFilesRecursively(SOURCE_DIR)).sort();
    const copyFiles = (await listFilesRecursively(COPY_DIR)).sort();

    const missingFromCopy = sourceFiles.filter((f) => !copyFiles.includes(f));
    const extraInCopy = copyFiles.filter((f) => !sourceFiles.includes(f));

    assert.deepEqual(
      missingFromCopy,
      [],
      `public/shared/ is missing files present in src/shared/: ${missingFromCopy.join(', ')}. ` +
        'Run `node scripts/copy-shared-for-vercel.js` and commit the result.',
    );
    assert.deepEqual(
      extraInCopy,
      [],
      `public/shared/ has files no longer in src/shared/: ${extraInCopy.join(', ')}. ` +
        'Run `node scripts/copy-shared-for-vercel.js` and commit the result.',
    );
  });

  it('is byte-identical to src/shared/ for every shared file', async () => {
    const sourceFiles = (await listFilesRecursively(SOURCE_DIR)).sort();
    const mismatched = [];

    for (const relativePath of sourceFiles) {
      const sourceHash = await hashFile(path.join(SOURCE_DIR, relativePath));
      let copyHash;
      try {
        copyHash = await hashFile(path.join(COPY_DIR, relativePath));
      } catch {
        continue; // already reported by the file-list test above
      }
      if (sourceHash !== copyHash) {
        mismatched.push(relativePath);
      }
    }

    assert.deepEqual(
      mismatched,
      [],
      `public/shared/ is out of sync with src/shared/ for: ${mismatched.join(', ')}. ` +
        'Run `node scripts/copy-shared-for-vercel.js` and commit the result.',
    );
  });
});
