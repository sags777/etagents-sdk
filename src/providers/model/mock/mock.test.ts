import { describe, it, expect } from "vitest";
import { MockModel } from "./mock.js";
import type { StreamChunk } from "../../../interfaces/model.js";

async function collect(gen: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe("MockModel", () => {
  describe("stream() — text response", () => {
    it("yields text chunk then finish chunk", async () => {
      const m = MockModel.create([{ kind: "text", content: "Hello, world!" }]);
      const chunks = await collect(m.stream([]));
      expect(chunks[0]).toMatchObject({ type: "text", delta: "Hello, world!" });
      expect(chunks.at(-1)).toMatchObject({ type: "finish", finishReason: "stop" });
    });

    it("finish is always the last chunk", async () => {
      const m = MockModel.create([{ kind: "text", content: "ok" }]);
      const chunks = await collect(m.stream([]));
      expect(chunks.at(-1)?.type).toBe("finish");
    });
  });

  describe("stream() — tool response", () => {
    it("yields tool_start → tool_delta → tool_end → finish", async () => {
      const m = MockModel.create([
        {
          kind: "tools",
          calls: [{ id: "call_1", name: "search", input: { query: "hello" } }],
        },
      ]);
      const chunks = await collect(m.stream([]));
      expect(chunks[0]).toMatchObject({
        type: "tool_start",
        toolCallId: "call_1",
        toolName: "search",
      });
      expect(chunks[1]).toMatchObject({ type: "tool_delta", toolCallId: "call_1" });
      expect(chunks[2]).toMatchObject({
        type: "tool_end",
        toolCallId: "call_1",
        input: { query: "hello" },
      });
      expect(chunks[3]).toMatchObject({ type: "finish", finishReason: "tool_use" });
    });

    it("emits correct chunk sequence for multiple tool calls", async () => {
      const m = MockModel.create([
        {
          kind: "tools",
          calls: [
            { id: "c1", name: "alpha", input: {} },
            { id: "c2", name: "beta", input: { x: 1 } },
          ],
        },
      ]);
      const chunks = await collect(m.stream([]));
      expect(chunks.map((c) => c.type)).toEqual([
        "tool_start",
        "tool_delta",
        "tool_end",
        "tool_start",
        "tool_delta",
        "tool_end",
        "finish",
      ]);
    });

    it("tool_end carries the full input object", async () => {
      const input = { location: "San Francisco", unit: "celsius" };
      const m = MockModel.create([
        { kind: "tools", calls: [{ id: "c1", name: "weather", input }] },
      ]);
      const chunks = await collect(m.stream([]));
      const end = chunks.find((c) => c.type === "tool_end");
      expect(end).toMatchObject({ type: "tool_end", input });
    });
  });

  describe("stream() — error response", () => {
    it("yields a single finish chunk with finishReason error", async () => {
      const m = MockModel.create([{ kind: "error", message: "upstream failed" }]);
      const chunks = await collect(m.stream([]));
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "finish",
        finishReason: "error",
        errorMsg: "upstream failed",
      });
    });

    it("yields error finish when queue is exhausted", async () => {
      const m = MockModel.create([]);
      const chunks = await collect(m.stream([]));
      expect(chunks.at(-1)).toMatchObject({ type: "finish", finishReason: "error" });
    });
  });

  describe("complete()", () => {
    it("assembles text content into ModelResponse", async () => {
      const m = MockModel.create([{ kind: "text", content: "assembled" }]);
      const r = await m.complete([]);
      expect(r.message.content).toBe("assembled");
      expect(r.finishReason).toBe("stop");
      expect(r.usage).toEqual({ prompt: 0, completion: 0, total: 0 });
    });

    it("returns tool_use finishReason for tool responses", async () => {
      const m = MockModel.create([
        { kind: "tools", calls: [{ id: "c1", name: "fn", input: {} }] },
      ]);
      const r = await m.complete([]);
      expect(r.finishReason).toBe("tool_use");
    });

    it("returns error finishReason for error responses", async () => {
      const m = MockModel.create([{ kind: "error", message: "oops" }]);
      const r = await m.complete([]);
      expect(r.finishReason).toBe("error");
    });
  });

  describe("signal abort", () => {
    it("stops immediately when signal is already aborted before stream starts", async () => {
      const m = MockModel.create([{ kind: "text", content: "should not appear" }]);
      const ac = new AbortController();
      ac.abort();
      const chunks = await collect(m.stream([], { signal: ac.signal }));
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ type: "finish", finishReason: "error" });
    });

    it("aborts cleanly during simulated delay", async () => {
      const m = MockModel.create([{ kind: "text", content: "delayed" }], 100);
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 10);
      const chunks = await collect(m.stream([], { signal: ac.signal }));
      expect(chunks.at(-1)).toMatchObject({ type: "finish", finishReason: "error" });
    });
  });

  describe("response queue ordering", () => {
    it("serves responses in FIFO order", async () => {
      const m = MockModel.create([
        { kind: "text", content: "first" },
        { kind: "text", content: "second" },
        { kind: "text", content: "third" },
      ]);
      for (const expected of ["first", "second", "third"]) {
        const chunks = await collect(m.stream([]));
        const textChunk = chunks.find((c) => c.type === "text");
        expect(textChunk).toMatchObject({ delta: expected });
      }
    });
  });
});
