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
