/**
 * A JSON-file-backed collection store.
 *
 * This is the project's data layer for now. It is deliberately small but not
 * naive -- the failure modes it guards against are the ones that actually bite
 * a file-backed store:
 *
 *   - **Torn writes.** Data is written to a temporary file and then renamed
 *     over the target. `rename` is atomic on both POSIX and NTFS, so a crash
 *     mid-write leaves the previous good file intact rather than a half-written
 *     one.
 *   - **Interleaved writes.** All writes go through a promise chain, so two
 *     concurrent requests can never have their flushes overlap.
 *   - **Corrupt data on load.** A file that fails to parse is set aside as
 *     `<name>.corrupt` and the store starts empty rather than crashing the
 *     process on boot.
 *
 * Everything is held in memory and mirrored to disk, which is fine at the scale
 * this project targets. {@link DataStore} in `./DataStore.js` defines the
 * interface, so swapping in SQLite or Postgres later means writing one new
 * class and changing one line in `./index.js`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { DataStore } from './DataStore.js';

export class JsonFileStore extends DataStore {
  /**
   * @param {object} options
   * @param {string} options.filePath absolute path to the backing JSON file
   * @param {number} [options.maxRecords=Infinity] cap on retained records; the
   *   oldest are evicted first
   * @param {number} [options.writeDebounceMs=0] coalesce bursts of writes into
   *   a single flush
   */
  constructor({ filePath, maxRecords = Infinity, writeDebounceMs = 0 }) {
    super();
    this.filePath = filePath;
    this.maxRecords = maxRecords;
    this.writeDebounceMs = writeDebounceMs;

    /** @type {object[]} */
    this.records = [];
    /** Serialises flushes; every write appends to this chain. */
    this.writeChain = Promise.resolve();
    /** @type {NodeJS.Timeout|null} */
    this.pendingFlush = null;
    this.loaded = false;
    /**
     * In-flight load, memoised. Concurrent callers must await the *same* load
     * rather than each starting their own -- otherwise a second load finishing
     * after the first would overwrite `records` and discard writes made in
     * between.
     * @type {Promise<void>|null}
     */
    this.loadPromise = null;
  }

  /**
   * Read the backing file into memory. Safe to call repeatedly and safe to call
   * concurrently; only the first call touches the disk.
   * @returns {Promise<this>}
   */
  async init() {
    if (this.loaded) return this;

    if (!this.loadPromise) {
      this.loadPromise = this.#load();
    }
    await this.loadPromise;
    return this;
  }

  /**
   * Perform the one-time read of the backing file.
   * @returns {Promise<void>}
   */
  async #load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.records = Array.isArray(parsed?.records) ? parsed.records : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        // First run: an empty store is the correct starting state.
        this.records = [];
      } else if (error instanceof SyntaxError) {
        await this.#quarantineCorruptFile();
        this.records = [];
      } else {
        // Leave `loadPromise` cleared so a later call can retry rather than
        // permanently caching the failure.
        this.loadPromise = null;
        throw error;
      }
    }

    this.loaded = true;
  }

  /**
   * Append a record, stamping it with an id and creation time.
   * @param {object} record
   * @returns {Promise<object>} the stored record, including generated fields
   */
  async insert(record) {
    await this.init();

    const stored = {
      id: record.id || randomUUID(),
      createdAt: record.createdAt || new Date().toISOString(),
      ...record
    };

    this.records.push(stored);

    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }

    await this.flush();
    return stored;
  }

  /**
   * Read-modify-write a single record. The read, the call to `updater`, and
   * the write into `this.records` all happen synchronously in one tick (only
   * `flush()` afterwards is async), so there's no window for a concurrent
   * `update()` on the same id to interleave and lose a write.
   *
   * @param {string} id
   * @param {(current: object) => object} updater receives the current record,
   *   returns the fields to merge over it
   * @returns {Promise<object|null>} the updated record, or `null` if `id` doesn't exist
   */
  async update(id, updater) {
    await this.init();

    const index = this.records.findIndex(record => record.id === id);
    if (index === -1) return null;

    const current = this.records[index];
    const updated = {
      ...current,
      ...updater(current),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };

    this.records[index] = updated;
    await this.flush();
    return updated;
  }

  /**
   * Read records, newest first.
   * @param {object} [query]
   * @param {number} [query.limit=50]
   * @param {number} [query.offset=0]
   * @param {(record: object) => boolean} [query.where] in-memory predicate
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async list({ limit = 50, offset = 0, where } = {}) {
    await this.init();

    const matching = where ? this.records.filter(where) : this.records;
    // Records are appended chronologically; callers want most-recent first.
    const ordered = matching.slice().reverse();

    return {
      items: ordered.slice(offset, offset + limit),
      total: matching.length,
      limit,
      offset
    };
  }

  /**
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    await this.init();
    return this.records.find(record => record.id === id) || null;
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>} true if a record was removed
   */
  async remove(id) {
    await this.init();

    const index = this.records.findIndex(record => record.id === id);
    if (index === -1) return false;

    this.records.splice(index, 1);
    await this.flush();
    return true;
  }

  /**
   * Drop every record.
   * @returns {Promise<number>} how many records were removed
   */
  async clear() {
    await this.init();

    const removed = this.records.length;
    this.records = [];
    await this.flush();
    return removed;
  }

  /** @returns {Promise<number>} */
  async count() {
    await this.init();
    return this.records.length;
  }

  /**
   * Persist the in-memory records to disk.
   *
   * Queued behind any in-flight flush, so concurrent callers cannot interleave.
   * With `writeDebounceMs` set, a burst of writes collapses into one disk hit.
   * @returns {Promise<void>}
   */
  flush() {
    if (this.writeDebounceMs > 0) {
      if (this.pendingFlush) clearTimeout(this.pendingFlush);
      return new Promise((resolve, reject) => {
        this.pendingFlush = setTimeout(() => {
          this.pendingFlush = null;
          this.#enqueueWrite().then(resolve, reject);
        }, this.writeDebounceMs);
        // Do not hold the event loop open purely for a pending flush.
        this.pendingFlush.unref?.();
      });
    }

    return this.#enqueueWrite();
  }

  /**
   * Flush immediately and stop any debounce timer. Called on shutdown so a
   * pending write is not lost when the process exits.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = null;
    }
    await this.#enqueueWrite();
  }

  /**
   * Append a write to the serial chain.
   * @returns {Promise<void>}
   */
  #enqueueWrite() {
    this.writeChain = this.writeChain
      .catch(() => {}) // A previous failure must not poison later writes.
      .then(() => this.#writeAtomically());
    return this.writeChain;
  }

  /**
   * Write to a sibling temp file, then rename over the target.
   * @returns {Promise<void>}
   */
  async #writeAtomically() {
    const payload = JSON.stringify(
      { version: 1, updatedAt: new Date().toISOString(), records: this.records },
      null,
      2
    );
    // The temp file must share a directory with the target: `rename` is only
    // atomic within a single filesystem.
    const tempPath = `${this.filePath}.${process.pid}.tmp`;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  /**
   * Move an unparseable file aside so the operator can inspect it and the
   * server can still start.
   * @returns {Promise<void>}
   */
  async #quarantineCorruptFile() {
    const quarantinePath = `${this.filePath}.corrupt`;
    try {
      await fs.rename(this.filePath, quarantinePath);
      console.warn(`[store] ${this.filePath} was unreadable; moved to ${quarantinePath}`);
    } catch (error) {
      console.warn(`[store] ${this.filePath} was unreadable and could not be quarantined:`, error.message);
    }
  }
}
