/**
 * ModelProvider — contract for every LLM backend.
 *
 * Contract rules (implementors must satisfy all):
 *   - `stream()` MUST yield a `finish` chunk before the async iterable ends,
 *     regardless of how the generation stops.
 *   - Tool chunks are ordered: `tool_start` → zero or more `tool_delta` →
 *     `tool_end`. A `tool_end` without a prior `tool_start` is a protocol error.
 *   - When `options.signal` is aborted, the implementation must stop yielding
 *     immediately and release any held resources (connections, buffers).
 *   - Network or provider errors must NOT throw out of `stream()`. Yield a
 *     `finish` chunk with `finishReason: "error"` and an optional `errorMsg`.
 *   - `complete()` is a convenience wrapper — it may be implemented by
 *     accumulating `stream()` output.
 */
export interface ModelProvider {
  /**
   * Single-shot completion. Returns after the model finishes.
   */
  complete(
    messages: ModelMessage[],
    options?: CompletionOptions,
  ): Promise<ModelResponse>;

  /**
   * Streaming completion. Yields chunks as they arrive.
   * See contract rules above — `finish` chunk is guaranteed as last emission.
   */
  stream(
    messages: ModelMessage[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: MessageRole;
  content: string | ContentPart[];
  /** Present when role is "tool" */
  toolCallId?: string;
}

export type ContentPart = TextPart | ImagePart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  /** Base-64 encoded data URI or a URL */
  source: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the input */
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CompletionOptions {
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** AbortSignal — provider must stop on abort */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface ModelResponse {
  message: ModelMessage;
  usage: TokenUsage;
  finishReason: FinishReason;
}

export type FinishReason = "stop" | "tool_use" | "length" | "error";

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Stream chunks — discriminated union
// ---------------------------------------------------------------------------

export type StreamChunk =
  | TextChunk
  | ToolStartChunk
  | ToolDeltaChunk
  | ToolEndChunk
  | FinishChunk;

export interface TextChunk {
  type: "text";
  delta: string;
}

export interface ToolStartChunk {
  type: "tool_start";
  toolCallId: string;
  toolName: string;
}

export interface ToolDeltaChunk {
  type: "tool_delta";
  toolCallId: string;
  /** Partial JSON fragment of the tool input */
  inputDelta: string;
}

export interface ToolEndChunk {
  type: "tool_end";
  toolCallId: string;
  /** Fully assembled input — provider must concatenate deltas */
  input: Record<string, unknown>;
}

export interface FinishChunk {
  type: "finish";
  finishReason: FinishReason;
  usage: TokenUsage;
  /** Present when finishReason is "error" */
  errorMsg?: string;
}
