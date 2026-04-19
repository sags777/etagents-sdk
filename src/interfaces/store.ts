/**
 * StoreProvider — contract for key/value persistence backends.
 *
 * Contract rules (implementors must satisfy all):
 *   - `read()` returns `null` on a cache miss. It must NEVER return `null`
 *     to signal an internal error — throw instead. Callers must be able to
 *     distinguish "key not found" from "store unavailable".
 *   - `write()` is atomic per key. Concurrent writes to the same key resolve
 *     as last-write-wins. Partial writes (e.g. mid-serialisation crash) must
 *     not leave corrupt data — the previous value must be preserved.
 *   - `list(prefix)` returns an empty array when no keys match. It must never
 *     throw simply because there are no results.
 *   - `remove()` is idempotent — removing a non-existent key is not an error.
 */
export interface StoreProvider {
  /**
   * Read a value by key.
   * Returns `null` on miss, throws on failure — never conflate the two.
   */
  read<T = unknown>(key: string): Promise<T | null>;

  /**
   * Write a value for a key.
   * Atomic per key. Optional TTL via `options.ttlMs`.
   */
  write<T = unknown>(key: string, value: T, options?: WriteOptions): Promise<void>;

  /**
   * Remove a key.
   * Idempotent — no error if the key does not exist.
   */
  remove(key: string): Promise<void>;

  /**
   * List all keys sharing a common prefix.
   * Returns `[]` (not an error) when nothing matches.
   */
  list(prefix: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WriteOptions {
  /** Time-to-live in milliseconds. Omit for no expiry. */
  ttlMs?: number;
}
