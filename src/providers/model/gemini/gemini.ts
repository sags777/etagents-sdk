import type {
  ModelProvider,
  ModelMessage,
  CompletionOptions,
  ModelResponse,
  StreamChunk,
  FinishReason,
} from "../../../interfaces/model.js";
import { collectStream, zeroUsage, sseLines, contentToString } from "../_stream.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GeminiModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Local API types (Gemini generateContent / streamGenerateContent)
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
}

interface GeminiChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: { message: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps Gemini finishReason values to the unified FinishReason. */
const FINISH_REASON: Partial<Record<string, FinishReason>> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "error",
  RECITATION: "error",
  OTHER: "error",
};

// ---------------------------------------------------------------------------
// SchemaTransformer — depth-first visitor that strips Gemini-incompatible nodes
// ---------------------------------------------------------------------------

/**
 * SchemaTransformer — walks a JSON Schema tree and removes fields that the
 * Gemini function-calling API rejects or does not understand.
 *
 * Transformations applied:
 *   - Remove `$schema`, `$defs`, `$ref`, `$id`, `$comment`
 *   - Remove `additionalProperties`, `default`, `examples`
 *   - Flatten `anyOf: [<type>, {type:"null"}]` → just the non-null schema
 *     (handles nullable fields in TypeScript-generated schemas)
 */
class SchemaTransformer {
  transform(schema: Record<string, unknown>): Record<string, unknown> {
    return this.visitObj(schema);
  }

  private visit(node: unknown): unknown {
    if (typeof node !== "object" || node === null) return node;
    if (Array.isArray(node)) return node.map((item) => this.visit(item));
    return this.visitObj(node as Record<string, unknown>);
  }

  private visitObj(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      if (["$schema", "$defs", "$ref", "$id", "$comment", "additionalProperties", "default", "examples", "exclusiveMinimum", "exclusiveMaximum"].includes(key)) {
        continue;
      }

      if (key === "anyOf" && Array.isArray(val)) {
        const nonNull = (val as unknown[]).filter(
          (v) => !(typeof v === "object" && v !== null && (v as Record<string, unknown>).type === "null"),
        );
        if (nonNull.length === 1) {
          Object.assign(out, this.visitObj(nonNull[0] as Record<string, unknown>));
          continue;
        }
        out[key] = nonNull.map((v) => this.visit(v));
        continue;
      }

      out[key] = this.visit(val);
    }

    return out;
  }
}

const schemaTransformer = new SchemaTransformer();

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

function toGeminiContents(messages: ModelMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    const text = contentToString(msg.content);
    if (msg.role === "tool") {
      out.push({ role: "user", parts: [{ functionResponse: { name: "", response: { result: text } } }] });
    } else {
      out.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text }] });
    }
  }
  return out;
}

function extractSystem(messages: ModelMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === "system");
  return sys ? contentToString(sys.content) : undefined;
}

function toFinishReason(raw: string | undefined): FinishReason {
  return (raw ? FINISH_REASON[raw] : undefined) ?? "stop";
}

// ---------------------------------------------------------------------------
// GeminiModel
// ---------------------------------------------------------------------------

/**
 * GeminiModel — Google Gemini streaming adapter via SSE REST API.
 *
 * Endpoint: `{baseUrl}/models/{model}:streamGenerateContent?alt=sse&key={apiKey}`
 *
 * Tool schema sanitization is applied automatically via SchemaTransformer
 * before sending function declarations to the API.
 */
export class GeminiModel implements ModelProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  private constructor(config: GeminiModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }

  static create(config: GeminiModelConfig): GeminiModel {
    return new GeminiModel(config);
  }

  async *stream(
    messages: ModelMessage[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    let inputTokens = 0;
    let outputTokens = 0;
    let lastFinishReason: string | undefined;

    try {
      const body: Record<string, unknown> = { contents: toGeminiContents(messages) };

      const sys = extractSystem(messages);
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };

      if (options?.temperature !== undefined || options?.maxTokens !== undefined) {
        const cfg: Record<string, unknown> = {};
        if (options.temperature !== undefined) cfg.temperature = options.temperature;
        if (options.maxTokens !== undefined) cfg.maxOutputTokens = options.maxTokens;
        body.generationConfig = cfg;
      }

      if (options?.tools && options.tools.length > 0) {
        body.tools = [{
          functionDeclarations: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: schemaTransformer.transform(t.inputSchema as Record<string, unknown>),
          })),
        }];
      }

      const url =
        `${this.baseUrl}/models/${this.model}:streamGenerateContent` +
        `?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!resp.ok || !resp.body) {
        const errText = resp.body ? await resp.text() : resp.statusText;
        yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: `Gemini ${resp.status}: ${errText}` };
        return;
      }

      for await (const line of sseLines(resp.body, options?.signal)) {
        if (options?.signal?.aborted) break;

        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(line) as GeminiChunk;
        } catch {
          continue;
        }

        if (chunk.error) {
          yield { type: "finish", finishReason: "error", usage: zeroUsage(), errorMsg: chunk.error.message };
          return;
        }

        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount;
          outputTokens = chunk.usageMetadata.candidatesTokenCount;
        }

        for (const candidate of chunk.candidates ?? []) {
          if (candidate.finishReason) lastFinishReason = candidate.finishReason;

          for (const part of candidate.content?.parts ?? []) {
            if (part.text !== undefined) {
              yield { type: "text", delta: part.text };
            }

            if (part.functionCall) {
              const callId = `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              yield { type: "tool_start", toolCallId: callId, toolName: part.functionCall.name };
              yield { type: "tool_delta", toolCallId: callId, inputDelta: JSON.stringify(part.functionCall.args) };
              yield { type: "tool_end", toolCallId: callId, input: part.functionCall.args };
            }
          }
        }
      }

      yield {
        type: "finish",
        finishReason: options?.signal?.aborted ? "error" : toFinishReason(lastFinishReason),
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
