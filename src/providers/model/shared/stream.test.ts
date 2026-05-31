import { describe, expect, it } from "vitest";
import {
  collectStream,
  contentToString,
  stripJsonFences,
  zeroUsage,
} from "./stream.js";
import type { StreamChunk } from "../../../types/contracts/model.js";

async function* streamChunks(
  chunks: StreamChunk[],
): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk;
}

describe("model shared stream helpers", () => {
  it("returns zero usage values", () => {
    expect(zeroUsage()).toEqual({ prompt: 0, completion: 0, total: 0 });
  });

  it("flattens multipart text content into a string", () => {
    expect(
      contentToString([
        { type: "text", text: "Hello" },
        { type: "image" },
        { type: "text", text: " world" },
      ]),
    ).toBe("Hello world");
  });

  it("strips fenced json wrappers", () => {
    expect(stripJsonFences("```json\n{\"ok\":true}\n```\n")).toBe(
      '{"ok":true}',
    );
  });

  it("collects text chunks into a ModelResponse", async () => {
    await expect(
      collectStream(
        streamChunks([
          { type: "text", delta: "Hello" },
          { type: "text", delta: " world" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { prompt: 1, completion: 2, total: 3 },
          },
        ]),
      ),
    ).resolves.toEqual({
      message: { role: "assistant", content: "Hello world" },
      finishReason: "stop",
      usage: { prompt: 1, completion: 2, total: 3 },
    });
  });
});