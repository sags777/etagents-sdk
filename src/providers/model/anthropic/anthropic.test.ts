import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../../../types/contracts/model.js";
import { AnthropicModel } from "./anthropic.js";

function buildSseBody(payloads: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = payloads.map((payload) => `data: ${payload}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collectChunks(
  gen: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe("AnthropicModel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts system prompts and completes text responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: buildSseBody([
        JSON.stringify({
          type: "message_start",
          message: { usage: { input_tokens: 3, output_tokens: 1 } },
        }),
        JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        }),
        JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 4 },
        }),
        JSON.stringify({ type: "message_stop" }),
      ]),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const model = AnthropicModel.create({
      apiKey: "anthropic-key",
      model: "claude-3-7-sonnet",
      baseUrl: "https://anthropic.example.test/",
    });

    await expect(
      model.complete(
        [
          { role: "system", content: "Be terse" },
          { role: "user", content: "Say hello" },
        ],
        { maxTokens: 64, temperature: 0.1 },
      ),
    ).resolves.toEqual({
      message: { role: "assistant", content: "Hello" },
      finishReason: "stop",
      usage: { prompt: 3, completion: 5, total: 8 },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://anthropic.example.test/v1/messages");
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    });

    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      max_tokens: number;
      temperature: number;
      system?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body).toMatchObject({
      model: "claude-3-7-sonnet",
      max_tokens: 64,
      temperature: 0.1,
      system: "Be terse",
    });
    expect(body.messages).toEqual([{ role: "user", content: "Say hello" }]);
  });

  it("assembles tool-use chunks from streamed anthropic events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: buildSseBody([
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "tool_1", name: "lookup" },
          }),
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"city":"San' },
          }),
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: ' Francisco"}' },
          }),
          JSON.stringify({ type: "content_block_stop", index: 0 }),
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 4 },
          }),
          JSON.stringify({ type: "message_stop" }),
        ]),
      } as Response),
    );

    const model = AnthropicModel.create({
      apiKey: "anthropic-key",
      model: "claude-3-7-sonnet",
    });
    const chunks = await collectChunks(
      model.stream([{ role: "user", content: "Look up San Francisco" }]),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "tool_start",
      "tool_delta",
      "tool_delta",
      "tool_end",
      "finish",
    ]);
    expect(chunks[0]).toMatchObject({
      type: "tool_start",
      toolCallId: "tool_1",
      toolName: "lookup",
    });
    expect(chunks[3]).toMatchObject({
      type: "tool_end",
      toolCallId: "tool_1",
      input: { city: "San Francisco" },
    });
    expect(chunks[4]).toMatchObject({
      type: "finish",
      finishReason: "tool_use",
      usage: { prompt: 0, completion: 4, total: 4 },
    });
  });
});