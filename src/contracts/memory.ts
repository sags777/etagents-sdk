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

  /**
   * Optional cross-encoder reranking pass.
   *
   * When provided, called after `search()` to reorder results by a richer
   * relevance signal (e.g. a cross-encoder model). The contract guarantees:
   *   - Input and output arrays have the same entries (no filtering).
   *   - Output is ordered by descending relevance.
   *   - Must not throw — swallow internal errors and return the input order.
   *
   * Omit to keep the default similarity-only ordering from `search()`.
   */
  rerank?(results: MemoryMatch[], query: string): Promise<MemoryMatch[]>;
}

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * MemoryKind — semantic category of an indexed memory entry.
 *
 * Preserved through the indexing pipeline so retrieval results carry the
 * typed origin of each memory (fact extracted from session, user-identity
 * fact, summarised outcome, or topic tag).
 */
export type MemoryKind = "fact" | "user_fact" | "summary" | "topic";

export interface MemoryEntry {
  id: string;
  text: string;
  scope: MemoryScope;
  /** Semantic category — preserved through indexing and returned on retrieval. */
  kind?: MemoryKind;
  /**
   * Confidence score in [0, 1] for this memory entry.
   * Starts at 1.0 for freshly indexed entries and decays over time.
   * Boosted when a confirming fact is re-indexed (reinforcement).
   */
  confidence?: number;
  /** ISO-8601 timestamp of when this entry was last indexed or reinforced. */
  updatedAt?: string;
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
  /** Semantic category of this memory entry, if available. */
  kind?: MemoryKind;
  /**
   * Confidence score at the time of retrieval, after any lazy decay.
   * Present when the provider stored a confidence on indexing.
   */
  confidence?: number;
  /** ISO-8601 timestamp of the last index or reinforcement event. */
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}
