import type {
  ModelProvider,
  ModelMessage,
  CompletionOptions,
  ModelResponse,
  StreamChunk,
  FinishReason,
  TokenUsage,
} from "../../../interfaces/model.js";
import { collectStream, zeroUsage, sseLines, contentToString } from "../_stream.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OpenAIModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Local API types (OpenAI chat completion chunk shapes)
// ---------------------------------------------------------------------------

interface OAIToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

interface OAIDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OAIToolCallDelta[];
}

interface OAIChunk {
  choices: Array<{
    index: number;
    delta: OAIDelta;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Per-call accumulator
interface CallAccum {
  id: string;
  name: string;
  argsBuf: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps OpenAI finish_reason values to the unified FinishReason. */
const FINISH_REASON: Partial<Record<string, FinishReason>> = {
  stop: "stop",
  tool_calls: "tool_use",
  length: "length",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toOpenAIMessages(messages: ModelMessage[]): unknown[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        tool_call_id: msg.toolCallId ?? "",
        content: contentToString(msg.content),
      };
    }
    return { role: msg.role, content: contentToString(msg.content) };
  });
}

function toFinishReason(raw: string | null): FinishReason {
  return (raw ? FINISH_REASON[raw] : undefined) ?? "stop";
}

// ---------------------------------------------------------------------------
// OpenAIModel
// ---------------------------------------------------------------------------

/**
 * OpenAIModel — OpenAI chat completions API streaming via raw SSE fetch.
 *
 * Chunk mapping:
 *   delta.content → text
 *   delta.tool_calls[i] with id → tool_start
 *   delta.tool_calls[i].function.arguments → tool_delta
 *   finish_reason: "tool_calls" → tool_end for all accumulated calls + finish
 *   finish_reason: "stop" → finish
 */
export class OpenAIModel implements ModelProvider {
  protected readonly apiKey: string;
  protected readonly model: string;
  protected chatUrl: string;

  constructor(config: OpenAIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.chatUrl = `${base}/chat/completions`;
  }

  /** Override in subclasses to supply different auth headers (e.g. Azure). */
  protected buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async *stream(
    messages: ModelMessage[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    const callAccums = new Map<number, CallAccum>();
    let usage: TokenUsage = zeroUsage();
    let lastFinishReason: string | null = null;

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: toOpenAIMessages(messages),
        stream: true,
        stream_options: { include_usage: true },
      };

      if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
      if (options?.temperature !== undefined) body.temperature = options.temperature;

      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }));
      }

      const resp = await fetch(this.chatUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!resp.ok || !resp.body) {
        const errText = resp.body ? await resp.text() : resp.statusText;
        yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: `OpenAI ${resp.status}: ${errText}` };
        return;
      }

      for await (const line of sseLines(resp.body, options?.signal)) {
        if (options?.signal?.aborted) break;

        let chunk: OAIChunk;
        try {
          chunk = JSON.parse(line) as OAIChunk;
        } catch {
          continue;
        }

        if (chunk.usage) {
          usage = {
            prompt: chunk.usage.prompt_tokens,
            completion: chunk.usage.completion_tokens,
            total: chunk.usage.total_tokens,
          };
        }

        for (const choice of chunk.choices) {
          const { delta } = choice;

          if (delta.content) {
            yield { type: "text", delta: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) {
                callAccums.set(tc.index, { id: tc.id, name: tc.function?.name ?? "", argsBuf: tc.function?.arguments ?? "" });
                yield { type: "tool_start", toolCallId: tc.id, toolName: tc.function?.name ?? "" };
              } else {
                const acc = callAccums.get(tc.index);
                if (acc && tc.function?.arguments) {
                  acc.argsBuf += tc.function.arguments;
                  yield { type: "tool_delta", toolCallId: acc.id, inputDelta: tc.function.arguments };
                }
              }
            }
          }

          if (choice.finish_reason) {
            lastFinishReason = choice.finish_reason;

            if (lastFinishReason === "tool_calls") {
              for (const acc of callAccums.values()) {
                let input: Record<string, unknown> = {};
                try { input = JSON.parse(acc.argsBuf) as Record<string, unknown>; } catch { /* malformed */ }
                yield { type: "tool_end", toolCallId: acc.id, input };
              }
              callAccums.clear();
            }

            yield { type: "finish", finishReason: toFinishReason(lastFinishReason), usage };
            return;
          }
        }
      }

      yield {
        type: "finish",
        finishReason: options?.signal?.aborted ? "error" : toFinishReason(lastFinishReason),
        usage,
      };
    } catch (err) {
      yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: String(err) };
    }
  }

  async complete(messages: ModelMessage[], options?: CompletionOptions): Promise<ModelResponse> {
    return collectStream(this.stream(messages, options));
  }
}
