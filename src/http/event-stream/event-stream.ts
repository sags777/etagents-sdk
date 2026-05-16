import { startRun, continueRun } from "../../kernel/index.js";
import { AgentRouter } from "../../orchestration/agent-router/agent-router.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunEvent } from "../../types/run.js";
import type { ApprovalDecision } from "../../types/checkpoint.js";
import type { RestoreConfig } from "../../kernel/index.js";
import type { StreamOptions } from "../stream-options.js";
import { toSseName, encodeMessage, encodeError } from "./_helpers.js";

// ---------------------------------------------------------------------------
// StreamTarget — union of single-agent and multi-agent entry points
// ---------------------------------------------------------------------------

/** A `SessionEventStream` can drive either a single agent or a multi-agent router. */
export type StreamTarget = AgentDef | AgentRouter;

// ---------------------------------------------------------------------------
// SSE headers
// ---------------------------------------------------------------------------

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};


// ---------------------------------------------------------------------------
// SessionEventStream — server-side SSE producer
// ---------------------------------------------------------------------------

/**
 * SessionEventStream — wraps `startRun()` / `continueRun()` (single-agent) or
 * `AgentRouter.run()` (multi-agent) and produces a `ReadableStream<Uint8Array>`
 * of SSE-formatted messages.
 *
 * Accepts either an {@link AgentDef} or an {@link AgentRouter} as the target.
 *
 * Usage (single agent):
 * ```ts
 * const stream = new SessionEventStream(agent);
 * stream.send("run_id", { runId });
 * const body = stream.stream("Hello");
 * ```
 *
 * Usage (multi-agent router):
 * ```ts
 * const router = AgentRouter.create().withStrategy(strategy).add(a).add(b).build();
 * const stream = new SessionEventStream(router);
 * stream.send("session_id", { sessionId });
 * const body = stream.stream("Hello");
 * ```
 *
 * Note: `send()` is designed for a single active stream at a time. Pre-run
 * calls are buffered and flushed when the stream starts.
 */
export class SessionEventStream {
  private readonly target: StreamTarget;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private readonly pending: Uint8Array[] = [];

  constructor(target: StreamTarget) {
    this.target = target;
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
    const target = this.target;
    const config = options.config ?? {};
    const externalOnEvent = options.onEvent;
    const self = this;

    return new ReadableStream<Uint8Array>({
      async start(ctrl) {
        self.controller = ctrl;
        // Flush any events sent before stream() was called
        for (const chunk of self.pending.splice(0)) {
          ctrl.enqueue(chunk);
        }
        try {
          const runConfig = {
            ...config,
            onEvent(event: RunEvent) {
              ctrl.enqueue(encodeMessage(toSseName(event), event));
              externalOnEvent?.(event);
            },
          };

          if (target instanceof AgentRouter) {
            await target.run(input, runConfig);
          } else {
            await startRun(target, input, runConfig);
          }
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
    const target = this.target;

    if (target instanceof AgentRouter) {
      throw new Error(
        "SessionEventStream.resume() is not supported for AgentRouter targets. " +
        "Construct a SessionEventStream with the individual AgentDef that was " +
        "suspended (available from the suspend snapshot).",
      );
    }

    const config = options.config ?? {};
    const externalOnEvent = options.onEvent;
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
            agent: target,
            signal: config.signal,
            metadata: config.metadata,
            onEvent(event: RunEvent) {
              ctrl.enqueue(encodeMessage(toSseName(event), event));
              externalOnEvent?.(event);
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
