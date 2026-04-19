import type {
  StreamChunk,
  FinishReason,
  TokenUsage,
  ModelResponse,
} from "../../interfaces/model.js";

// ---------------------------------------------------------------------------
// Shared streaming utilities for all ModelProvider implementations
// ---------------------------------------------------------------------------

/** Zero-value TokenUsage — used for error/empty cases. */
export function zeroUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0 };
}

/**
 * Parse a ReadableStream of SSE bytes into individual `data:` payloads.
 * Skips empty lines, comments, and the `[DONE]` sentinel.
 */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data && data !== "[DONE]") yield data;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Flatten multipart content to a plain string.
 * Handles both `string` and `ContentPart[]` message content.
 */
export function contentToString(content: string | { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");
}

/**
 * Consume an async iterable of StreamChunks into a single ModelResponse.
 * Accumulates text deltas and captures the final finish chunk.
 */
export async function collectStream(gen: AsyncIterable<StreamChunk>): Promise<ModelResponse> {
  let content = "";
  let finishReason: FinishReason = "stop";
  let usage = zeroUsage();
  for await (const chunk of gen) {
    if (chunk.type === "text") content += chunk.delta;
    if (chunk.type === "finish") {
      finishReason = chunk.finishReason;
      usage = chunk.usage;
    }
  }
  return { message: { role: "assistant", content }, usage, finishReason };
}
