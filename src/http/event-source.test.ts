import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionEventSource } from "./event-source.js";

// ---------------------------------------------------------------------------
// Helpers — build a minimal SSE fetch mock
// ---------------------------------------------------------------------------

function buildSseBody(events: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text));
      ctrl.close();
    },
  });
}

function mockFetch(events: Array<{ event: string; data: unknown }>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: buildSseBody(events),
    }),
  );
}

const DONE_PAYLOAD = { kind: "complete", result: { response: "ok", status: "success" } };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionEventSource", () => {
  describe("readyState", () => {
    it("starts as connecting", () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent", {
        body: { prompt: "hi" },
      });
      expect(src.readyState).toBe("connecting");
      return src.result.catch(() => null);
    });

    it("transitions to closed after stream ends", async () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent", {
        body: { prompt: "hi" },
      });
      await src.result;
      expect(src.readyState).toBe("closed");
    });
  });

  describe("on()", () => {
    it("fires handler for matching event", async () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent", {
        body: { prompt: "hi" },
      });
      const received: unknown[] = [];
      src.on("run.done", (d) => received.push(d));
      await src.result;
      expect(received).toHaveLength(1);
    });

    it("returns this for chaining", () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent");
      expect(src.on("open", () => {})).toBe(src);
      return src.result.catch(() => null);
    });

    it("dispatches open event when connection opens", async () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent");
      let opened = false;
      src.on("open", () => { opened = true; });
      await src.result;
      expect(opened).toBe(true);
    });

    it("dispatches close event when stream ends", async () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent");
      let closed = false;
      src.on("close", () => { closed = true; });
      await src.result;
      expect(closed).toBe(true);
    });
  });

  describe("result promise", () => {
    it("resolves with the CompleteEvent payload", async () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent", {
        body: { prompt: "hi" },
      });
      const result = await src.result;
      expect(result).toMatchObject(DONE_PAYLOAD);
    });

    it("rejects when fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
      const src = new SessionEventSource("/api/agent");
      await expect(src.result).rejects.toThrow("Network error");
    });

    it("rejects when server returns non-200", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          body: null,
        }),
      );
      const src = new SessionEventSource("/api/agent");
      await expect(src.result).rejects.toThrow("SSE connection failed: 500");
    });

    it("rejects when stream closes without run.done", async () => {
      mockFetch([{ event: "run.status", data: { kind: "turn_start", turn: 1 } }]);
      const src = new SessionEventSource("/api/agent");
      await expect(src.result).rejects.toThrow("run.done");
    });
  });

  describe("close()", () => {
    it("aborts the fetch connection", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body: new ReadableStream({ start() {} }), // never closes
      });
      vi.stubGlobal("fetch", fetchMock);

      const src = new SessionEventSource("/api/agent");
      src.close();

      const call = fetchMock.mock.calls[0];
      const signal = (call?.[1] as RequestInit)?.signal;
      expect(signal?.aborted).toBe(true);
    });
  });

  describe("async iteration", () => {
    it("yields all received events", async () => {
      mockFetch([
        { event: "run.status", data: { kind: "turn_start", turn: 1 } },
        { event: "run.done", data: DONE_PAYLOAD },
      ]);
      const src = new SessionEventSource("/api/agent");
      const events: string[] = [];
      for await (const { event } of src) {
        events.push(event);
      }
      expect(events).toContain("run.done");
    });
  });

  describe("fetch options", () => {
    it("uses GET by default when no body is provided", () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent");
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call?.[1] as RequestInit)?.method).toBe("GET");
      return src.result.catch(() => null);
    });

    it("uses POST when body is provided", () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent", { body: { prompt: "hi" } });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call?.[1] as RequestInit)?.method).toBe("POST");
      return src.result.catch(() => null);
    });

    it("merges custom headers into the request", () => {
      mockFetch([{ event: "run.done", data: DONE_PAYLOAD }]);
      const src = new SessionEventSource("/api/agent", {
        headers: { "X-Custom": "value" },
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = (call?.[1] as RequestInit)?.headers as Record<string, string>;
      expect(headers?.["X-Custom"]).toBe("value");
      return src.result.catch(() => null);
    });
  });
});
