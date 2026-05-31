import { describe, it, expect } from "vitest";
import { SessionEventStream, SSE_HEADERS } from "./event-stream.js";
import { createAgent } from "../agent/agent-builder.js";
import { MockModel } from "../providers/model/mock/mock.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function collectFrames(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const parts: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(decoder.decode(value, { stream: true }));
  }
  return parts.join("");
}

function parseEventNames(raw: string): string[] {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("event: "))
    .map((l) => l.slice("event: ".length).trim());
}

function parseDataObjects(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => {
      try {
        return JSON.parse(l.slice("data: ".length));
      } catch {
        return null;
      }
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE_HEADERS", () => {
  it("sets Content-Type to text/event-stream", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
  });

  it("sets Cache-Control to disable caching", () => {
    expect(SSE_HEADERS["Cache-Control"]).toContain("no-cache");
  });

  it("sets Connection to keep-alive", () => {
    expect(SSE_HEADERS["Connection"]).toBe("keep-alive");
  });
});

describe("SessionEventStream", () => {
  describe("stream()", () => {
    it("emits run.done for a complete text run", async () => {
      const model = MockModel.create([{ kind: "text", content: "All done." }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const names = parseEventNames(await collectFrames(ses.stream("Hello")));

      expect(names).toContain("run.done");
    });

    it("emits at least two run.status events (turn_start + turn_end)", async () => {
      const model = MockModel.create([{ kind: "text", content: "ok" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const names = parseEventNames(await collectFrames(ses.stream("Hello")));

      expect(names.filter((n) => n === "run.status").length).toBeGreaterThanOrEqual(2);
    });

    it("each SSE frame has both event: and data: lines", async () => {
      const model = MockModel.create([{ kind: "text", content: "hi" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const blocks = (await collectFrames(ses.stream("Hello")))
        .split("\n\n")
        .filter((b) => b.trim().length > 0);

      for (const block of blocks) {
        expect(block).toMatch(/^event: /m);
        expect(block).toMatch(/^data: /m);
      }
    });

    it("data payloads are valid JSON", async () => {
      const model = MockModel.create([{ kind: "text", content: "done" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const objects = parseDataObjects(await collectFrames(ses.stream("Hello")));

      expect(objects.length).toBeGreaterThan(0);
      for (const obj of objects) {
        expect(obj).not.toBeNull();
      }
    });

    it("run.done payload has kind: complete", async () => {
      const model = MockModel.create([{ kind: "text", content: "Final answer." }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      const lines = raw.split("\n");
      const doneIdx = lines.findIndex((l) => l === "event: run.done");
      expect(doneIdx).toBeGreaterThanOrEqual(0);

      const payload = JSON.parse(lines[doneIdx + 1].slice("data: ".length));
      expect(payload.kind).toBe("complete");
    });

    it("stream closes without hanging when model errors", async () => {
      const model = MockModel.create([{ kind: "error", message: "API down" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      expect(raw.length).toBeGreaterThan(0);
    });

    it("pre-send events are flushed as the first SSE frames", async () => {
      const model = MockModel.create([{ kind: "text", content: "hi" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      ses.send("run_id", { runId: "abc123" });
      const raw = await collectFrames(ses.stream("Hello"));
      const names = parseEventNames(raw);

      expect(names[0]).toBe("run_id");
    });
  });

  describe("resume()", () => {
    it("throws when target is an AgentRouter", async () => {
      const { AgentRouter } = await import("../orchestration/agent-router/agent-router.js");
      const { RuleRouter } = await import("../orchestration/strategies/rule/rule.js");
      const model = MockModel.create([{ kind: "text", content: "hi" }]);
      const agent = createAgent({ name: "a", systemPrompt: "s", model });
      const strategy = new RuleRouter().when(/./, agent).build();
      const router = AgentRouter.create().add(agent).withStrategy(strategy).build();
      const ses = new SessionEventStream(router);

      expect(() => ses.resume("id", [])).toThrow("not supported for AgentRouter");
    });
  });
});
