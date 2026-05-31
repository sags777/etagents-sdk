import { describe, it, expect } from "vitest";
import { toExpressHandler } from "./express.js";
import { SSE_HEADERS } from "../event-stream.js";
import { createAgent } from "../../agent/agent-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";

// ---------------------------------------------------------------------------
// Test helpers — minimal Express req/res stubs
// ---------------------------------------------------------------------------

function makeAgent() {
  return createAgent({
    name: "a",
    systemPrompt: "You help.",
    model: MockModel.create([{ kind: "text", content: "ok" }]),
  });
}

interface StubResponse {
  headers: Record<string, string>;
  chunks: (Uint8Array | string)[];
  ended: boolean;
  setHeader(name: string, value: string): void;
  write(chunk: Uint8Array | string): boolean;
  end(): void;
}

function makeStubResponse(): StubResponse {
  return {
    headers: {},
    chunks: [],
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    write(chunk) {
      this.chunks.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
  };
}

async function waitForEnd(res: StubResponse): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (res.ended) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };
    check();
  });
}

function collectOutput(res: StubResponse): string {
  const decoder = new TextDecoder();
  return res.chunks
    .map((c) => (c instanceof Uint8Array ? decoder.decode(c) : c))
    .join("");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toExpressHandler", () => {
  it("returns a function", () => {
    expect(typeof toExpressHandler(makeAgent())).toBe("function");
  });

  it("sets SSE Content-Type header", async () => {
    const handler = toExpressHandler(makeAgent());
    const res = makeStubResponse();
    handler({ body: "Hello" }, res);
    await waitForEnd(res);
    expect(res.headers["Content-Type"]).toBe(SSE_HEADERS["Content-Type"]);
  });

  it("sets Cache-Control header", async () => {
    const handler = toExpressHandler(makeAgent());
    const res = makeStubResponse();
    handler({ body: "Hello" }, res);
    await waitForEnd(res);
    expect(res.headers["Cache-Control"]).toContain("no-cache");
  });

  it("merges custom headers with SSE_HEADERS", async () => {
    const handler = toExpressHandler(makeAgent(), {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
    const res = makeStubResponse();
    handler({ body: "Hello" }, res);
    await waitForEnd(res);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(res.headers["Content-Type"]).toBe(SSE_HEADERS["Content-Type"]);
  });

  it("streams SSE events and calls end()", async () => {
    const handler = toExpressHandler(makeAgent());
    const res = makeStubResponse();
    handler({ body: "Hello" }, res);
    await waitForEnd(res);
    const output = collectOutput(res);
    expect(output).toContain("event: run.done");
    expect(res.ended).toBe(true);
  });

  it("serialises non-string bodies to JSON", async () => {
    const agent = makeAgent();
    const handler = toExpressHandler(agent);
    const res = makeStubResponse();
    handler({ body: { prompt: "Hello" } }, res);
    await waitForEnd(res);
    expect(res.ended).toBe(true);
  });
});
