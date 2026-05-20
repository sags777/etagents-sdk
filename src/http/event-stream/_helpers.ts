import type { RunEvent } from "../../types/run.js";

// ---------------------------------------------------------------------------
// Shared SSE encoding helpers used by SessionEventStream
// ---------------------------------------------------------------------------

export const encoder = new TextEncoder();

/**
 * Maps a RunEvent to its SSE dot-notation event name.
 */
export function toSseName(event: RunEvent): string {
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

export function encodeMessage(eventName: string, data: unknown): Uint8Array {
  const text = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  return encoder.encode(text);
}

export function encodeError(message: string): Uint8Array {
  return encodeMessage("run.error", {
    kind: "error",
    message,
    code: "STREAM_ERROR",
  });
}

// ---------------------------------------------------------------------------
// createDeltaBuffer — text_delta coalescing factory
// ---------------------------------------------------------------------------

/**
 * createDeltaBuffer — returns an `onEvent` handler and a `flush` function
 * that coalesce rapid single-character `text_delta` SSE frames into larger
 * chunks before writing to the wire.
 *
 * Flush strategy (whichever fires first):
 *   - Sentence/paragraph boundary after a minimum buffered size
 *   - Max buffer guardrail (to cap latency/memory)
 *   - Trailing timer: 150 ms after the most recent un-flushed delta
 *
 * All non-`text_delta` events drain the buffer immediately so event ordering
 * on the wire is preserved.
 *
 * Usage:
 * ```ts
 * const { onEvent, flush } = createDeltaBuffer(ctrl, externalOnEvent);
 * try {
 *   await startRun(agent, input, { ...config, onEvent });
 * } catch (err) {
 *   flush();
 *   ctrl.enqueue(encodeError(...));
 * } finally {
 *   flush();          // drain any remaining buffer
 *   ctrl.close();
 * }
 * ```
 */
export function createDeltaBuffer(
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  externalOnEvent?: (event: RunEvent) => void,
): { onEvent: (event: RunEvent) => void; flush: () => void } {
  const TRAILING_FLUSH_MS = 150;
  const MIN_BOUNDARY_FLUSH_CHARS = 24;
  const MAX_BUFFER_CHARS = 512;
  const SENTENCE_OR_PARAGRAPH_BOUNDARY = /(?:[.!?](?:["')\]]+)?\s$|\n{2,}$)/;

  let deltaBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTurn = 0;

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (deltaBuffer.length === 0) return;
    ctrl.enqueue(encodeMessage("run.text.delta", { kind: "text_delta", delta: deltaBuffer, turn: currentTurn }));
    deltaBuffer = "";
  }

  function onEvent(event: RunEvent) {
    if (event.kind === "text_delta") {
      currentTurn = event.turn;
      deltaBuffer += event.delta;
      externalOnEvent?.(event);

      const shouldFlushForBoundary =
        deltaBuffer.length >= MIN_BOUNDARY_FLUSH_CHARS &&
        SENTENCE_OR_PARAGRAPH_BOUNDARY.test(deltaBuffer);

      if (shouldFlushForBoundary || deltaBuffer.length >= MAX_BUFFER_CHARS) {
        flush();
      } else {
        // Trailing timer: coalesce until stream activity pauses.
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, TRAILING_FLUSH_MS);
      }
      return;
    }
    // Non-text_delta: drain buffer first to preserve event ordering on the wire
    flush();
    ctrl.enqueue(encodeMessage(toSseName(event), event));
    externalOnEvent?.(event);
  }

  return { onEvent, flush };
}
