import { startRun, continueRun } from "../../kernel/index.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunConfig, RunEvent } from "../../types/run.js";
import type { ApprovalDecision } from "../../types/checkpoint.js";
import type { RestoreConfig } from "../../kernel/index.js";

// ---------------------------------------------------------------------------
// SSE headers
// ---------------------------------------------------------------------------

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Maps a RunEvent to its SSE dot-notation event name.
 * Legacy names like "session_complete" are not used here.
 */
function toSseName(event: RunEvent): string {
  switch (event.kind) {
    case "turn_start":
    case "turn_end":
    case "warning":
    case "exceeded":
      return "run.status";
    case "tool_call":
      return "tool.invoke";
    case "tool_result":
      return "tool.result";
    case "error":
      return "run.error";
    case "complete":
      return "run.done";
  }
}

function encodeMessage(eventName: string, data: unknown): Uint8Array {
  const text = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  return encoder.encode(text);
}

function encodeError(message: string): Uint8Array {
  return encodeMessage("run.error", {
    kind: "error",
    message,
    code: "STREAM_ERROR",
  });
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Per-stream configuration — mirrors RunConfig minus the onEvent slot. */
export interface StreamOptions {
  config?: Omit<RunConfig, "onEvent">;
}

// ---------------------------------------------------------------------------
// EtaEventStream — server-side SSE producer
// ---------------------------------------------------------------------------

/**
 * SessionEventStream — wraps `startRun()` / `continueRun()` and produces a
 * `ReadableStream<Uint8Array>` of SSE-formatted messages.
 *
 * Usage:
 * ```ts
 * const stream = new SessionEventStream(agent);
 * const body = stream.stream("Hello");
 * // pipe body to an HTTP response with SSE_HEADERS
 * ```
 */
export class SessionEventStream {
  private readonly agent: AgentDef;

  constructor(agent: AgentDef) {
    this.agent = agent;
  }

  /**
   * Start a new run and stream its events as SSE.
   */
  stream(input: string, options: StreamOptions = {}): ReadableStream<Uint8Array> {
    const agent = this.agent;
    const config = options.config ?? {};

    return new ReadableStream<Uint8Array>({
      async start(ctrl) {
        try {
          await startRun(agent, input, {
            ...config,
            onEvent(event: RunEvent) {
              ctrl.enqueue(encodeMessage(toSseName(event), event));
            },
          });
        } catch (err) {
          ctrl.enqueue(encodeError(err instanceof Error ? err.message : String(err)));
        } finally {
          ctrl.close();
        }
      },
    });
  }

  /**
   * Resume a HITL-suspended run and stream remaining events as SSE.
   */
  resume(
    checkpointId: string,
    decisions: ApprovalDecision[],
    options: StreamOptions = {},
  ): ReadableStream<Uint8Array> {
    const agent = this.agent;
    const config = options.config ?? {};

    return new ReadableStream<Uint8Array>({
      async start(ctrl) {
        try {
          const restoreConfig: RestoreConfig = {
            agent,
            signal: config.signal,
            metadata: config.metadata,
            onEvent(event: RunEvent) {
              ctrl.enqueue(encodeMessage(toSseName(event), event));
            },
          };
          await continueRun(checkpointId, decisions, restoreConfig);
        } catch (err) {
          ctrl.enqueue(encodeError(err instanceof Error ? err.message : String(err)));
        } finally {
          ctrl.close();
        }
      },
    });
  }
}
