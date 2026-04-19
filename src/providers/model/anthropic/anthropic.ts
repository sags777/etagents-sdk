import type {
  ModelProvider,
  ModelMessage,
  CompletionOptions,
  ModelResponse,
  StreamChunk,
  FinishReason,
} from "../../../interfaces/model.js";
import { zeroUsage, sseLines, contentToString, collectStream } from "../_stream.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AnthropicModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  anthropicVersion?: string;
}

// ---------------------------------------------------------------------------
// Local API types (Anthropic SSE event shapes)
// ---------------------------------------------------------------------------

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string };

type AnthropicDelta =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string };

type AnthropicEvent =
  | { type: "message_start"; message: { usage: { input_tokens: number; output_tokens: number } } }
  | { type: "content_block_start"; index: number; content_block: AnthropicContentBlock }
  | { type: "content_block_delta"; index: number; delta: AnthropicDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string | null }; usage: { output_tokens: number } }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: { message: string } };

// Per-block accumulator for tool call assembly
interface ToolAccum {
  id: string;
  name: string;
  jsonBuf: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps Anthropic stop_reason values to the unified FinishReason. */
const STOP_REASON: Partial<Record<string, FinishReason>> = {
  end_turn: "stop",
  tool_use: "tool_use",
  max_tokens: "length",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAnthropicMessages(messages: ModelMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId ?? "",
            content: contentToString(msg.content),
          },
        ],
      });
    } else {
      out.push({ role: msg.role, content: contentToString(msg.content) });
    }
  }
  return out;
}

function extractSystem(messages: ModelMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === "system");
  return sys ? contentToString(sys.content) : undefined;
}

function toFinishReason(raw: string | null | undefined): FinishReason {
  return (raw ? STOP_REASON[raw] : undefined) ?? "stop";
}

// ---------------------------------------------------------------------------
// AnthropicModel
// ---------------------------------------------------------------------------

/**
 * AnthropicModel — Anthropic Messages API streaming via raw SSE fetch.
 *
 * Chunk mapping:
 *   content_block_start (tool_use) → tool_start
 *   content_block_delta (input_json_delta) → tool_delta
 *   content_block_stop for tool block → tool_end (with assembled input)
 *   content_block_delta (text_delta) → text
 *   message_delta → determines finishReason + final usage
 */
export class AnthropicModel implements ModelProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;

  private constructor(config: AnthropicModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.anthropicVersion = config.anthropicVersion ?? "2023-06-01";
  }

  static create(config: AnthropicModelConfig): AnthropicModel {
    return new AnthropicModel(config);
  }

  async *stream(
    messages: ModelMessage[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    const toolAccums = new Map<number, ToolAccum>();
    const blockTypes = new Map<number, string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        messages: toAnthropicMessages(messages),
        stream: true,
      };

      const sys = extractSystem(messages);
      if (sys) body.system = sys;
      if (options?.temperature !== undefined) body.temperature = options.temperature;

      if (options?.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      }

      const resp = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": this.anthropicVersion,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!resp.ok || !resp.body) {
        const errText = resp.body ? await resp.text() : resp.statusText;
        yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: `Anthropic ${resp.status}: ${errText}` };
        return;
      }

      for await (const line of sseLines(resp.body, options?.signal)) {
        if (options?.signal?.aborted) break;

        let event: AnthropicEvent;
        try {
          event = JSON.parse(line) as AnthropicEvent;
        } catch {
          continue;
        }

        switch (event.type) {
          case "message_start":
            inputTokens = event.message.usage.input_tokens;
            outputTokens = event.message.usage.output_tokens;
            break;

          case "content_block_start": {
            const cb = event.content_block;
            blockTypes.set(event.index, cb.type);
            if (cb.type === "tool_use") {
              toolAccums.set(event.index, { id: cb.id, name: cb.name, jsonBuf: "" });
              yield { type: "tool_start", toolCallId: cb.id, toolName: cb.name };
            }
            break;
          }

          case "content_block_delta": {
            const d = event.delta;
            if (d.type === "text_delta") {
              yield { type: "text", delta: d.text };
            } else if (d.type === "input_json_delta") {
              const acc = toolAccums.get(event.index);
              if (acc) {
                acc.jsonBuf += d.partial_json;
                yield { type: "tool_delta", toolCallId: acc.id, inputDelta: d.partial_json };
              }
            }
            break;
          }

          case "content_block_stop": {
            if (blockTypes.get(event.index) === "tool_use") {
              const acc = toolAccums.get(event.index);
              if (acc) {
                let input: Record<string, unknown> = {};
                try { input = JSON.parse(acc.jsonBuf) as Record<string, unknown>; } catch { /* malformed */ }
                yield { type: "tool_end", toolCallId: acc.id, input };
                toolAccums.delete(event.index);
              }
            }
            break;
          }

          case "message_delta":
            outputTokens += event.usage.output_tokens;
            stopReason = event.delta.stop_reason;
            break;

          case "message_stop":
            yield { type: "finish", finishReason: toFinishReason(stopReason), usage: { prompt: inputTokens, completion: outputTokens, total: inputTokens + outputTokens } };
            return;

          case "error":
            yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: event.error.message };
            return;
        }
      }

      // Stream ended without message_stop (e.g. aborted)
      yield {
        type: "finish",
        finishReason: options?.signal?.aborted ? "error" : toFinishReason(stopReason),
        usage: { prompt: inputTokens, completion: outputTokens, total: inputTokens + outputTokens },
      };
    } catch (err) {
      yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: String(err) };
    }
  }

  async complete(messages: ModelMessage[], options?: CompletionOptions): Promise<ModelResponse> {
    return collectStream(this.stream(messages, options));
  }
}
