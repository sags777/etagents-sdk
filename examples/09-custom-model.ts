// examples/09-custom-model.ts
// ─────────────────────────────────────────────────────────────────────────────
// Implement ModelProvider against a local Ollama server.
// Prerequisites: Ollama running at http://localhost:11434 with a model pulled.
// Run: npx tsx examples/09-custom-model.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun } from "../src/index.js";
import type {
  ModelProvider,
  ModelMessage,
  ModelResponse,
  CompletionOptions,
  StreamChunk,
  TokenUsage,
} from "../src/index.js";

// ── OllamaModel — ModelProvider backed by a local Ollama server ──────────────

class OllamaModel implements ModelProvider {
  private readonly baseUrl: string;
  private readonly modelId: string;

  constructor({ baseUrl = "http://localhost:11434", model }: { baseUrl?: string; model: string }) {
    this.baseUrl = baseUrl;
    this.modelId = model;
  }

  async complete(messages: ModelMessage[], options?: CompletionOptions): Promise<ModelResponse> {
    // Accumulate the stream to produce a single response
    const chunks: StreamChunk[] = [];
    for await (const chunk of this.stream(messages, options)) {
      chunks.push(chunk);
    }

    let text = "";
    let usage: TokenUsage = { prompt: 0, completion: 0, total: 0 };
    for (const chunk of chunks) {
      if (chunk.type === "text") text += chunk.delta;
      if (chunk.type === "finish") usage = chunk.usage;
    }

    return {
      message: { role: "assistant", content: text },
      usage,
      finishReason: "stop",
    };
  }

  async *stream(
    messages: ModelMessage[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    const ollamaMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));

    const system = messages.find((m) => m.role === "system");

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelId,
          messages: ollamaMessages,
          system: system?.content,
          stream: true,
          options: { num_predict: options?.maxTokens ?? 256 },
        }),
        signal: options?.signal,
      });
    } catch (err) {
      yield { type: "finish", finishReason: "error", usage: { prompt: 0, completion: 0, total: 0 }, errorMsg: String(err) };
      return;
    }

    if (!response.body) {
      yield { type: "finish", finishReason: "error", usage: { prompt: 0, completion: 0, total: 0 } };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n").filter(Boolean);
        for (const line of lines) {
          let parsed: { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number };
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            continue;
          }

          if (parsed.message?.content) {
            yield { type: "text", delta: parsed.message.content };
          }
          if (parsed.done) {
            promptTokens = parsed.prompt_eval_count ?? 0;
            completionTokens = parsed.eval_count ?? 0;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "finish",
      finishReason: "stop",
      usage: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    };
  }
}

// ── Use the custom model ──────────────────────────────────────────────────────

const agent = createAgent({
  name: "local-assistant",
  systemPrompt: "You are a concise local assistant powered by Ollama.",
  // Pass a ModelProvider instance directly — no string shorthand needed
  model: new OllamaModel({ model: "llama3.2" }),
});

const result = await startRun(agent, "What is 2 + 2? Answer in one sentence.");

console.log("Response:", result.response);
