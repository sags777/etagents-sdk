import { describe, it, expect } from "vitest";
import { toNextHandler, toNextResponse } from "./next.js";
import { SessionEventStream, SSE_HEADERS } from "../event-stream.js";
import { createAgent } from "../../agent/agent-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";

// ---------------------------------------------------------------------------
// Test helpers
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

function makeAgent() {
  return createAgent({
    name: "a",
    systemPrompt: "You help.",
    model: MockModel.create([{ kind: "text", content: "ok" }]),
  });
}

// ---------------------------------------------------------------------------
// toNextHandler
// ---------------------------------------------------------------------------

describe("toNextHandler", () => {
  it("returns a function", () => {
    expect(typeof toNextHandler(makeAgent())).toBe("function");
  });

  it("responds with SSE Content-Type header", async () => {
    const handler = toNextHandler(makeAgent());
    const req = { text: async () => "Hello" };
    const res = await handler(req);
    expect(res.headers.get("Content-Type")).toBe(SSE_HEADERS["Content-Type"]);
  });

  it("responds with 200 status by default", async () => {
    const handler = toNextHandler(makeAgent());
    const res = await handler({ text: async () => "Hello" });
    expect(res.status).toBe(200);
  });

  it("merges custom headers into the response", async () => {
    const handler = toNextHandler(makeAgent(), {
      headers: { "X-Custom": "value" },
    });
    const res = await handler({ text: async () => "Hello" });
    expect(res.headers.get("X-Custom")).toBe("value");
  });

  it("uses a custom status code when provided", async () => {
    const handler = toNextHandler(makeAgent(), { status: 201 });
    const res = await handler({ text: async () => "Hello" });
    expect(res.status).toBe(201);
  });

  it("streams SSE events containing run.done", async () => {
    const handler = toNextHandler(makeAgent());
    const res = await handler({ text: async () => "Hello" });
    const raw = await collectFrames(res.body as ReadableStream<Uint8Array>);
    expect(raw).toContain("event: run.done");
  });
});

// ---------------------------------------------------------------------------
// toNextResponse
// ---------------------------------------------------------------------------

describe("toNextResponse", () => {
  it("returns a Response with SSE Content-Type", () => {
    const agent = makeAgent();
    const stream = new SessionEventStream(agent);
    const res = toNextResponse(stream, "Hello");
    expect(res.headers.get("Content-Type")).toBe(SSE_HEADERS["Content-Type"]);
  });

  it("defaults to status 200", () => {
    const agent = makeAgent();
    const stream = new SessionEventStream(agent);
    const res = toNextResponse(stream, "Hello");
    expect(res.status).toBe(200);
  });

  it("uses provided status code", () => {
    const agent = makeAgent();
    const stream = new SessionEventStream(agent);
    const res = toNextResponse(stream, "Hello", { status: 202 });
    expect(res.status).toBe(202);
  });

  it("merges extra headers with SSE_HEADERS", () => {
    const agent = makeAgent();
    const stream = new SessionEventStream(agent);
    const res = toNextResponse(stream, "Hello", {
      headers: { "X-Run-Id": "xyz" },
    });
    expect(res.headers.get("X-Run-Id")).toBe("xyz");
    expect(res.headers.get("Content-Type")).toBe(SSE_HEADERS["Content-Type"]);
  });

  it("pre-sent events appear first in the stream", async () => {
    const agent = makeAgent();
    const stream = new SessionEventStream(agent);
    stream.send("run_id", { runId: "abc" });
    const res = toNextResponse(stream, "Hello");
    const raw = await collectFrames(res.body as ReadableStream<Uint8Array>);
    const firstEvent = raw.split("\n").find((l) => l.startsWith("event: "));
    expect(firstEvent).toBe("event: run_id");
  });
});
