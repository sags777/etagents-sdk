import { startRun, continueRun } from "../../kernel/index.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunEvent } from "../../types/run.js";
import type { ApprovalDecision } from "../../types/checkpoint.js";
import type { RestoreConfig } from "../../kernel/index.js";
import type { StreamOptions } from "../types.js";

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
    case "agent_routed":
    case "agent_complete":
      return "run.status";
    case "text_delta":
      return "run.text.delta";
    case "text_done":
      return "run.text.done";
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
// EtaEventStream — server-side SSE producer
// ---------------------------------------------------------------------------

/**
 * SessionEventStream — wraps `startRun()` / `continueRun()` and produces a
 * `ReadableStream<Uint8Array>` of SSE-formatted messages.
 *
 * Usage:
 * ```ts
 * const stream = new SessionEventStream(agent);
 * stream.send("run_id", { runId });   // inject a custom pre-run event
 * const body = stream.stream("Hello");
 * // pipe body to an HTTP response with SSE_HEADERS
 * ```
 *
 * Note: `send()` is designed for a single active stream at a time. Pre-run
 * calls are buffered and flushed when the stream starts.
 */
export class SessionEventStream {
  private readonly agent: AgentDef;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private readonly pending: Uint8Array[] = [];

  constructor(agent: AgentDef) {
    this.agent = agent;
  }

  // ---------------------------------------------------------------------------
  // send — inject a custom SSE event
  // ---------------------------------------------------------------------------

  /**
   * Emit a custom SSE event on the current stream.
   *
   * If called before `stream()` / `resume()`, the event is buffered and
   * flushed to the client as the first message(s) once the stream opens.
   *
   * ```ts
   * const eventStream = new SessionEventStream(agent);
   * eventStream.send("run_id", { runId: "abc123" });   // sent before kernel events
   * return toNextResponse(eventStream, prompt);
   * ```
   */
  send(eventName: string, data: unknown): void {
    const chunk = encodeMessage(eventName, data);
    if (this.controller) {
      this.controller.enqueue(chunk);
    } else {
      this.pending.push(chunk);
    }
  }

  // ---------------------------------------------------------------------------
  // stream
  // ---------------------------------------------------------------------------

  /**
   * Start a new run and stream its events as SSE.
   */
  stream(input: string, options: StreamOptions = {}): ReadableStream<Uint8Array> {
    const agent = this.agent;
    const config = options.config ?? {};
    const self = this;

    return new ReadableStream<Uint8Array>({
      async start(ctrl) {
        self.controller = ctrl;
        // Flush any events sent before stream() was called
        for (const chunk of self.pending.splice(0)) {
          ctrl.enqueue(chunk);
        }
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
          self.controller = undefined;
          ctrl.close();
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // resume
  // ---------------------------------------------------------------------------

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
    const self = this;

    return new ReadableStream<Uint8Array>({
      async start(ctrl) {
        self.controller = ctrl;
        // Flush any pre-queued events
        for (const chunk of self.pending.splice(0)) {
          ctrl.enqueue(chunk);
        }
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
          self.controller = undefined;
          ctrl.close();
        }
      },
    });
  }
}
