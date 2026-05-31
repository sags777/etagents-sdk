import type {
  StreamChunk,
  FinishReason,
  TokenUsage,
  ModelResponse,
} from "../../../types/contracts/model.js";

/**
 * Shared streaming utilities for all ModelProvider implementations.
 */

/** Zero-value TokenUsage — used for error/empty cases. */
export function zeroUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0 };
}

/**
 * Flatten multipart content to a plain string.
 * Handles both `string` and `ContentPart[]` message content.
 */
export function contentToString(
  content: string | { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");
}

/**
 * Strip markdown code fences from a model response that is expected to be
 * plain JSON. Some models wrap their output in ```json ... ``` despite being
 * instructed not to. This is model-agnostic — apply it anywhere a raw JSON
 * string is expected from `model.complete()`.
 */
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Consume an async iterable of StreamChunks into a single ModelResponse.
 * Accumulates text deltas and captures the final finish chunk.
 */
export async function collectStream(
  gen: AsyncIterable<StreamChunk>,
): Promise<ModelResponse> {
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
