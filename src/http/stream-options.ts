import type { RunConfig } from "../types/run.js";

// ---------------------------------------------------------------------------
// Shared HTTP transport types
// ---------------------------------------------------------------------------

/** Per-stream configuration — mirrors RunConfig minus the onEvent slot. */
export interface StreamOptions {
  config?: Omit<RunConfig, "onEvent">;
}