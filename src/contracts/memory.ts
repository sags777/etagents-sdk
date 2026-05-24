/**
 * MemoryProvider — contract for vector / semantic memory backends.
 *
 * Contract rules (implementors must satisfy all):
 *   - `index()` must NEVER throw to the caller. Swallow internal errors,
 *     optionally log them, and return normally. The kernel must not crash
 *     because a memory write failed.
 *   - `search()` scores must be normalised to the range [0, 1] regardless
 *     of the underlying distance metric (cosine, dot-product, L2, etc.).
 *   - `delete(id)` is idempotent — deleting a non-existent id is not an error.
 *   - `clear(scope)` is a hard delete. There is no soft-delete, recycle bin,
 *     or recovery path. Callers must confirm intent before calling.
 */
export interface MemoryProvider {
  /**
   * Index a text entry for later retrieval.
   * Must not throw — see contract rules.
   */
  index(entry: MemoryEntry): Promise<void>;

  /**
   * Search for entries semantically similar to `query`.
   * Returns results ordered by descending score.
   */
  search(query: string, options?: MemorySearchOptions): Promise<MemoryMatch[]>;

  /**
   * Remove a single entry by id.
   * Idempotent — no error if id does not exist.
   */
  delete(id: string): Promise<void>;

  /**
   * Hard-delete all entries matching the given scope.
   * See contract rules — there is no undo.
   */
  clear(scope: MemoryScope): Promise<void>;
}

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  text: string;
  scope: MemoryScope;
  metadata?: Record<string, unknown>;
}

export interface MemoryScope {
  agentId: string;
  namespace: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface MemorySearchOptions {
  scope?: Partial<MemoryScope>;
  /** Maximum number of results. Default: provider-defined. */
  limit?: number;
  /** Minimum score threshold (0–1). Results below this are excluded. */
  minScore?: number;
}

export interface MemoryMatch {
  id: string;
  text: string;
  /** Normalised similarity score in [0, 1] */
  score: number;
  metadata?: Record<string, unknown>;
}
