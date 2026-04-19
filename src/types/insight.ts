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
