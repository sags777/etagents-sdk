import { startRun, continueRun } from "../kernel/index.js";
import { AgentRouter } from "../orchestration/agent-router/agent-router.js";
import type { AgentDef } from "../types/agent.js";
import type { ApprovalDecision } from "../types/checkpoint.js";
import type { RestoreConfig } from "../kernel/entry/continue.js";
import type { RunEvent } from "../types/run.js";
import type { StreamOptions } from "./stream-options.js";
import { encodeMessage, encodeError, createDeltaBuffer } from "./sse-helpers.js";

// ---------------------------------------------------------------------------
// StreamTarget
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
 * stream.send("request_id", { clientRequestId: "req_123" });
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

  /**
   * Emit a custom SSE event on the current stream.
   *
   * If called before `stream()` / `resume()`, the event is buffered and
   * flushed to the client as the first message(s) once the stream opens.
   *
   * ```ts
   * const eventStream = new SessionEventStream(agent);
  * eventStream.send("request_id", { clientRequestId: "req_123" });
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

  /** Start a new run and stream its events as SSE. */
  stream(input: string, options: StreamOptions = {}): ReadableStream<Uint8Array> {
    const { config = {}, onEvent } = options;
    const target = this.target;

    return this.createRunStream(
      (handler) => {
        const runConfig = { ...config, onEvent: handler };
        return target instanceof AgentRouter
          ? target.run(input, runConfig)
          : startRun(target, input, runConfig);
      },
      onEvent,
    );
  }

  /**
   * Resume a HITL-suspended run and stream remaining events as SSE.
   */
  resume(
    checkpointId: string,
    decisions: ApprovalDecision[],
    options: StreamOptions = {},
  ): ReadableStream<Uint8Array> {
    if (this.target instanceof AgentRouter) {
      throw new Error(
        "SessionEventStream.resume() is not supported for AgentRouter targets. " +
          "Construct a SessionEventStream with the individual AgentDef that was " +
          "suspended (available from the suspend snapshot).",
      );
    }

    const target = this.target;
    const { config = {}, onEvent } = options;

    return this.createRunStream(
      (handler) => {
        const restoreConfig: RestoreConfig = {
          agent: target,
          signal: config.signal,
          metadata: config.metadata,
          onEvent: handler,
        };
        return continueRun(checkpointId, decisions, restoreConfig);
      },
      onEvent,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createRunStream(
    runFn: (onEvent: (event: RunEvent) => void) => Promise<unknown>,
    externalOnEvent?: (event: RunEvent) => void,
  ): ReadableStream<Uint8Array> {
    const self = this;

    return new ReadableStream<Uint8Array>({
      async start(ctrl) {
        self.controller = ctrl;
        for (const chunk of self.pending.splice(0)) {
          ctrl.enqueue(chunk);
        }

        const { onEvent, flush } = createDeltaBuffer(ctrl, externalOnEvent);

        try {
          await runFn(onEvent);
        } catch (err) {
          flush();
          ctrl.enqueue(
            encodeError(err instanceof Error ? err.message : String(err)),
          );
        } finally {
          flush();
          self.controller = undefined;
          ctrl.close();
        }
      },
    });
  }
}
