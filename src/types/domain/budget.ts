// ---------------------------------------------------------------------------
// Budget types
// ---------------------------------------------------------------------------

/**
 * BudgetConfig — token spending limits for a run.
 *
 * `warnAt` is a fraction (0–1) of maxTokens at which a "warning" event fires.
 * Defaults to 0.8 when not specified.
 */
export interface BudgetConfig {
  maxTokens: number;
  warnAt?: number;
}

export interface BudgetState {
  prompt: number;
  completion: number;
  total: number;
}

export interface BudgetEvent {
  kind: "warning" | "exceeded";
  state: BudgetState;
}
