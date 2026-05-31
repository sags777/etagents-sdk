import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../../../types/contracts/model.js";
import { OpenAIModel } from "./openai.js";

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

describe("OpenAIModel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes text responses and sends the expected request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: buildSseBody([
        JSON.stringify({
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        }),
        JSON.stringify({
          choices: [
            { index: 0, delta: { content: " world" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
      ]),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const model = new OpenAIModel({
      apiKey: "openai-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.test/v1/",
    });

    await expect(
      model.complete(
        [
          { role: "system", content: "Be brief" },
          { role: "user", content: "Say hello" },
        ],
        { maxTokens: 128, temperature: 0.2 },
      ),
    ).resolves.toEqual({
      message: { role: "assistant", content: "Hello world" },
      finishReason: "stop",
      usage: { prompt: 2, completion: 3, total: 5 },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.test/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "application/json",
      Authorization: "Bearer openai-key",
    });

    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      max_tokens: number;
      temperature: number;
      stream: boolean;
      stream_options: { include_usage: boolean };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      max_tokens: 128,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(body.messages).toEqual([
      { role: "system", content: "Be brief" },
      { role: "user", content: "Say hello" },
    ]);
  });

  it("assembles streamed tool calls into tool chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: buildSseBody([
          JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "search",
                        arguments: '{"query":"San',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
          JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: ' Francisco"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
          }),
        ]),
      } as Response),
    );

    const model = new OpenAIModel({ apiKey: "openai-key", model: "gpt-4o-mini" });
    const chunks = await collectChunks(
      model.stream([{ role: "user", content: "Search for San Francisco" }]),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "tool_start",
      "tool_delta",
      "tool_end",
      "finish",
    ]);
    expect(chunks[0]).toMatchObject({
      type: "tool_start",
      toolCallId: "call_1",
      toolName: "search",
    });
    expect(chunks[1]).toMatchObject({
      type: "tool_delta",
      toolCallId: "call_1",
      inputDelta: ' Francisco"}',
    });
    expect(chunks[2]).toMatchObject({
      type: "tool_end",
      toolCallId: "call_1",
      input: { query: "San Francisco" },
    });
    expect(chunks[3]).toMatchObject({
      type: "finish",
      finishReason: "tool_use",
      usage: { prompt: 4, completion: 5, total: 9 },
    });
  });
});