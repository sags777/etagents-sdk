import type { RunConfig } from "../types/run.js";
import type { RunEvent } from "../types/run.js";

// ---------------------------------------------------------------------------
// Shared HTTP transport types
// ---------------------------------------------------------------------------

/**
 * Per-stream configuration passed to `SessionEventStream.stream()` /
 * `SessionEventStream.resume()`.
 *
 * `onEvent` is a side-effect hook fired for every `RunEvent` **after** the
 * event has already been encoded and enqueued to the SSE stream.  Use it to
 * build conversation buffers, log telemetry, or update application state
 * without needing to wrap the stream in a `TransformStream`.
 */
export interface StreamOptions {
  config?: Omit<RunConfig, "onEvent">;
  /** Optional hook — called for every RunEvent alongside SSE encoding. */
  onEvent?: (event: RunEvent) => void;
}
