import type { TokenUsage } from "../../interfaces/model.js";
import type { BudgetState, BudgetEvent } from "../../types/budget.js";

// ---------------------------------------------------------------------------
// BudgetLedger — tracks token spend for a single run
// ---------------------------------------------------------------------------

/**
 * BudgetLedger — accumulates token usage and fires budget events.
 *
 * Construct with an optional callback; the callback fires synchronously
 * inside `checkAndEmit()` when a warning or exceeded threshold is crossed.
 * Events are NOT deduplicated — callers should gate on `isExceeded` if needed.
 */
export class BudgetLedger {
  private prompt = 0;
  private completion = 0;
  private total = 0;
  private readonly onBudgetEvent?: (event: BudgetEvent) => void;

  constructor(onBudgetEvent?: (event: BudgetEvent) => void) {
    this.onBudgetEvent = onBudgetEvent;
  }

  add(usage: TokenUsage): void {
    this.prompt += usage.prompt;
    this.completion += usage.completion;
    this.total += usage.total;
  }

  state(): BudgetState {
    return { prompt: this.prompt, completion: this.completion, total: this.total };
  }

  isExceeded(limit: number): boolean {
    return this.total >= limit;
  }

  isWarning(limit: number, warnAt: number): boolean {
    return this.total >= limit * warnAt && this.total < limit;
  }

  /**
   * Fire a budget event if a threshold has been crossed.
   * Called by the kernel after each `add()`.
   */
  checkAndEmit(limit: number, warnAt = 0.8): void {
    if (!this.onBudgetEvent) return;
    const state = this.state();
    if (this.isExceeded(limit)) {
      this.onBudgetEvent({ kind: "exceeded", state });
    } else if (this.isWarning(limit, warnAt)) {
      this.onBudgetEvent({ kind: "warning", state });
    }
  }
}
