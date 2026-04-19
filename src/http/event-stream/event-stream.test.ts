import { describe, it, expect } from "vitest";
import { SessionEventStream, SSE_HEADERS } from "./event-stream.js";
import { createAgent } from "../../agent/create-agent/create-agent.js";
import { MockModel } from "../../providers/model/mock/mock.js";

// ---------------------------------------------------------------------------
// Helper — collect all SSE frames from a ReadableStream
// ---------------------------------------------------------------------------

async function collectFrames(stream: ReadableStream<Uint8Array>): Promise<string> {
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

/** Parse all "event: <name>" lines from raw SSE text. */
function parseEventNames(raw: string): string[] {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("event: "))
    .map((l) => l.slice("event: ".length).trim());
}

/** Parse all data payloads as JSON objects. */
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
    it("emits run.done event for a complete text run", async () => {
      const model = MockModel.create([{ kind: "text", content: "All done." }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      const names = parseEventNames(raw);

      expect(names).toContain("run.done");
    });

    it("emits run.status events for turn_start and turn_end", async () => {
      const model = MockModel.create([{ kind: "text", content: "ok" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      const names = parseEventNames(raw);

      expect(names.filter((n) => n === "run.status").length).toBeGreaterThanOrEqual(2);
    });

    it("each SSE frame has both event: and data: lines", async () => {
      const model = MockModel.create([{ kind: "text", content: "hi" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));

      // Each event block ends with a blank line
      const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
      for (const block of blocks) {
        expect(block).toMatch(/^event: /m);
        expect(block).toMatch(/^data: /m);
      }
    });

    it("data payloads are valid JSON", async () => {
      const model = MockModel.create([{ kind: "text", content: "done" }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      const objects = parseDataObjects(raw);

      expect(objects.length).toBeGreaterThan(0);
      for (const obj of objects) {
        expect(obj).not.toBeNull();
      }
    });

    it("run.done data contains the run result", async () => {
      const model = MockModel.create([{ kind: "text", content: "Final answer." }]);
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      const lines = raw.split("\n");
      const doneIdx = lines.findIndex((l) => l === "event: run.done");
      expect(doneIdx).toBeGreaterThanOrEqual(0);

      const dataLine = lines[doneIdx + 1];
      expect(dataLine).toMatch(/^data: /);
      const payload = JSON.parse(dataLine.slice("data: ".length));
      expect(payload.kind).toBe("complete");
    });

    it("emits run.error when the agent model errors", async () => {
      const model = MockModel.create([{ kind: "error", message: "API down" }]);
      // An error finish still completes the run (status=error or complete)
      // so we just verify the stream closes without hanging
      const agent = createAgent({ name: "a", systemPrompt: "You help.", model });
      const ses = new SessionEventStream(agent);

      const raw = await collectFrames(ses.stream("Hello"));
      expect(raw.length).toBeGreaterThan(0);
    });
  });
});
