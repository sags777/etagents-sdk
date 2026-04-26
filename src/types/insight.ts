// ---------------------------------------------------------------------------
// Insight types
// ---------------------------------------------------------------------------

/**
 * InsightConfig — controls the automatic fact-extraction and summarisation
 * pass run at the end of each turn.
 *
 * `model` overrides the agent's model for the insight pass (useful for
 * using a cheaper model when the primary model is expensive).
 */
export interface InsightConfig {
  model?: string;
  maxFacts?: number;
  /**
   * Minimum number of turns before the insight pass runs.
   * Skips extraction on trivial single-turn Q&A sessions to save tokens.
   */
  minTurns?: number;
  /**
   * When true, a short hypothetical answer is generated before vector-searching
   * memory, improving recall via the HyDE (Hypothetical Document Embeddings) technique.
   */
  hypothesize?: boolean;
  /** Custom prompt overrides for fact extraction and summarisation */
  prompts?: {
    extractFacts?: string;
    summarise?: string;
  };
}

export interface InsightResult {
  facts: string[];
  userFacts: string[];
  summary: string;
  topics: string[];
}
