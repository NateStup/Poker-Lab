/**
 * Deterministic pseudo-random number generation.
 *
 * Monte Carlo results are only trustworthy if you can reproduce them. Every
 * simulation in this project draws from an injected RNG rather than calling
 * `Math.random()` directly, so a run can be replayed exactly by replaying its
 * seed. That property is what lets the history store record a seed alongside a
 * result and have the result mean something later.
 */

/**
 * Hash an arbitrary string into a 32-bit unsigned integer.
 * Lets callers use readable seeds such as `'aces-vs-kings'`.
 * @param {string} text
 * @returns {number} a 32-bit unsigned integer
 */
export function hashSeed(text) {
  // FNV-1a: short, dependency-free, and well distributed for short strings.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Coerce any seed representation into a 32-bit unsigned integer.
 * @param {number|string|null|undefined} seed
 * @returns {number}
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length > 0) return hashSeed(seed);
  // No usable seed: fall back to a non-deterministic one so callers who do not
  // care about reproducibility still get varied results.
  return (Math.random() * 0x100000000) >>> 0;
}

/**
 * A small, fast, seedable PRNG (mulberry32).
 *
 * Not cryptographically secure and not meant to be -- it is a simulation RNG
 * chosen for speed and reproducibility.
 */
export class Rng {
  /** @param {number|string} [seed] */
  constructor(seed) {
    this.seed = normalizeSeed(seed);
    this.state = this.seed;
  }

  /**
   * Next float in [0, 1).
   * @returns {number}
   */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Next integer in [0, max).
   * @param {number} max exclusive upper bound
   * @returns {number}
   */
  nextInt(max) {
    return Math.floor(this.next() * max);
  }

  /**
   * Restart the sequence from the original seed.
   * @returns {this}
   */
  reset() {
    this.state = this.seed;
    return this;
  }
}

/**
 * Convenience factory.
 * @param {number|string} [seed]
 * @returns {Rng}
 */
export function createRng(seed) {
  return new Rng(seed);
}
