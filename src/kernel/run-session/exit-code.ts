import type { ExitCode, RunResult } from "../../types/domain/run.js";

/**
 * exitCodeToStatus — maps an internal ExitCode to the public RunResult status.
 */
export function exitCodeToStatus(code: ExitCode): RunResult["status"] {
  const TABLE: Record<ExitCode, RunResult["status"]> = {
    COMPLETE: "complete",
    MAX_TURNS: "complete",
    BUDGET: "budget_exceeded",
    SUSPEND: "awaiting_approval",
    ABORT: "cancelled",
  };
  return TABLE[code];
}
