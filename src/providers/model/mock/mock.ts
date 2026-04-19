import type {
  ModelProvider,
  ModelMessage,
  CompletionOptions,
  ModelResponse,
  StreamChunk,
} from "../../../interfaces/model.js";
import { zeroUsage, collectStream } from "../_stream.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MockToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Shape of each queued response. */
export type MockResponse =
  | { kind: "text"; content: string }
  | { kind: "tools"; calls: MockToolCall[] }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delay that rejects when the signal fires — makes abort work mid-sleep. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); },
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// MockModel
// ---------------------------------------------------------------------------

/**
 * MockModel — deterministic ModelProvider for tests.
 *
 * Responses are served FIFO from the queue. When the queue is exhausted,
 * subsequent calls yield a `finish` chunk with `finishReason: "error"`.
 *
 * @param responses  Ordered list of responses to serve.
 * @param delayMs    Optional simulated latency per stream call.
 */
export class MockModel implements ModelProvider {
  private readonly queue: MockResponse[];
  private readonly delayMs: number;

  private constructor(responses: MockResponse[], delayMs: number) {
    this.queue = [...responses];
    this.delayMs = delayMs;
  }

  static create(responses: MockResponse[], delayMs = 0): MockModel {
    return new MockModel(responses, delayMs);
  }

  async *stream(
    _messages: ModelMessage[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    if (options?.signal?.aborted) {
      yield { type: "finish", finishReason: "error", usage: zeroUsage() };
      return;
    }

    if (this.delayMs > 0) {
      try {
        await sleep(this.delayMs, options?.signal);
      } catch {
        yield { type: "finish", finishReason: "error", usage: zeroUsage() };
        return;
      }
    }

    const resp: MockResponse = this.queue.shift() ?? {
      kind: "error",
      message: "MockModel: response queue exhausted",
    };

    switch (resp.kind) {
      case "text":
        yield { type: "text", delta: resp.content };
        yield { type: "finish", finishReason: "stop", usage: zeroUsage() };
        break;

      case "tools":
        for (const call of resp.calls) {
          if (options?.signal?.aborted) break;
          yield { type: "tool_start", toolCallId: call.id, toolName: call.name };
          yield { type: "tool_delta", toolCallId: call.id, inputDelta: JSON.stringify(call.input) };
          yield { type: "tool_end", toolCallId: call.id, input: call.input };
        }
        yield { type: "finish", finishReason: "tool_use", usage: zeroUsage() };
        break;

      case "error":
        yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: resp.message };
        break;
    }
  }

  async complete(messages: ModelMessage[], options?: CompletionOptions): Promise<ModelResponse> {
    return collectStream(this.stream(messages, options));
  }
}
