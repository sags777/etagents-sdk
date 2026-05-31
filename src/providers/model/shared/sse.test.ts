import { describe, expect, it } from "vitest";
import { sseLines } from "./sse.js";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collectLines(
  gen: AsyncIterable<string>,
): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of gen) lines.push(line);
  return lines;
}

describe("sseLines", () => {
  it("yields only data payloads and skips empty or done sentinel lines", async () => {
    const body = streamFromText(
      [
        ": comment",
        "data: {\"first\":true}",
        "",
        "data: [DONE]",
        "data: second payload",
        "",
      ].join("\n"),
    );

    await expect(collectLines(sseLines(body))).resolves.toEqual([
      '{"first":true}',
      "second payload",
    ]);
  });

  it("stops immediately when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      collectLines(sseLines(streamFromText("data: hello\n\n"), controller.signal)),
    ).resolves.toEqual([]);
  });
});