/**
 * Password hashing, using Node's built-in `crypto.scrypt` rather than a
 * dependency like bcrypt or argon2 -- this codebase adds dependencies
 * deliberately rather than reflexively, and scrypt is a respected,
 * memory-hard KDF already sitting in the standard library. Isolated in its
 * own module, with no imports from the rest of the app, so it's the one file
 * worth reading closely if anyone ever needs to audit how passwords are
 * handled here.
 *
 * The stored format is self-describing -- `scrypt:N:r:p:salt:hash`, with the
 * cost parameters written alongside the hash rather than assumed from
 * whatever constants happen to be in this file today. That means the
 * constants below can change later (a faster server, a few years of Moore's
 * law) without invalidating every password hashed under the old ones --
 * verification reads the parameters a hash was actually created with, not
 * the current constants.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** Output length in bytes. 64 is generous; scrypt's cost lives in N/r/p, not here. */
const KEY_LENGTH = 64;
/** CPU/memory cost, as a power of two. 2^14 is the widely-cited minimum for interactive login. */
const N = 16384;
/** Block size. 8 is scrypt's standard value, tuned against N for its memory/CPU balance. */
const R = 8;
/** Parallelization. 1, since there's no reason to parallelize a single login check. */
const P = 1;

/**
 * @param {string} password
 * @returns {Promise<string>} `scrypt:N:r:p:saltHex:hashHex`
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * @param {string} password a plaintext candidate
 * @param {string} stored the value `hashPassword` produced
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split(':') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr)
  });

  // timingSafeEqual over a plain === comparison: comparing byte-by-byte and
  // stopping early at the first mismatch leaks, via response timing, how many
  // leading bytes an attacker's guess got right. Both buffers must be the
  // same length before it's called, which the identical KEY_LENGTH above
  // guarantees for any hash this module produced -- checked explicitly here
  // anyway, since `derived.length` depends on parameters read from `stored`,
  // not from this module's own constants.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
