import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../../../types/contracts/model.js";
import { GeminiModel } from "./gemini.js";

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

describe("GeminiModel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sanitizes tool schemas and completes text responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: buildSseBody([
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Hello" }, { text: " world" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 2,
            candidatesTokenCount: 3,
            totalTokenCount: 5,
          },
        }),
      ]),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const model = GeminiModel.create({
      apiKey: "gemini-key",
      model: "gemini-1.5-pro",
      baseUrl: "https://gemini.example.test/v1beta/",
      customHeaders: async () => ({ "x-test-header": "1" }),
    });

    await expect(
      model.complete(
        [
          { role: "system", content: "Be concise" },
          { role: "user", content: "Say hello" },
        ],
        {
          maxTokens: 32,
          temperature: 0.4,
          tools: [
            {
              name: "lookup",
              description: "Lookup a city",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  city: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                    default: "Paris",
                  },
                },
                examples: ["unused"],
              },
            },
          ],
        },
      ),
    ).resolves.toEqual({
      message: { role: "assistant", content: "Hello world" },
      finishReason: "stop",
      usage: { prompt: 2, completion: 3, total: 5 },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://gemini.example.test/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse&key=gemini-key",
    );
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "application/json",
      "x-test-header": "1",
    });

    const body = JSON.parse((init as RequestInit).body as string) as {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
      systemInstruction?: { parts: Array<{ text: string }> };
      generationConfig?: { temperature: number; maxOutputTokens: number };
      tools?: Array<{
        functionDeclarations: Array<{ parameters: Record<string, unknown> }>;
      }>;
    };

    expect(body.systemInstruction).toEqual({ parts: [{ text: "Be concise" }] });
    expect(body.generationConfig).toEqual({
      temperature: 0.4,
      maxOutputTokens: 32,
    });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Say hello" }] },
    ]);

    const parameters = body.tools?.[0]?.functionDeclarations[0]?.parameters;
    expect(parameters).toMatchObject({
      type: "object",
      properties: { city: { type: "string" } },
    });
    expect(parameters).not.toHaveProperty("additionalProperties");
    expect(parameters).not.toHaveProperty("examples");
  });

  it("emits tool chunks for Gemini function calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: buildSseBody([
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { functionCall: { name: "lookup", args: { city: "Paris" } } },
                  ],
                },
                finishReason: "FUNCTION_CALL",
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
            },
          }),
        ]),
      } as Response),
    );

    const model = GeminiModel.create({ model: "gemini-1.5-pro" });
    const chunks = await collectChunks(
      model.stream([{ role: "user", content: "Look up Paris" }]),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "tool_start",
      "tool_delta",
      "tool_end",
      "finish",
    ]);

    const start = chunks[0];
    if (start?.type !== "tool_start") {
      throw new Error("expected tool_start chunk");
    }

    expect(start.toolName).toBe("lookup");
    expect(chunks[1]).toMatchObject({
      type: "tool_delta",
      toolCallId: start.toolCallId,
      inputDelta: JSON.stringify({ city: "Paris" }),
    });
    expect(chunks[2]).toMatchObject({
      type: "tool_end",
      toolCallId: start.toolCallId,
      input: { city: "Paris" },
    });
    expect(chunks[3]).toMatchObject({
      type: "finish",
      finishReason: "tool_use",
      usage: { prompt: 1, completion: 1, total: 2 },
    });
  });
});