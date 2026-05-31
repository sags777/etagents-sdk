import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postJSON } from "./http.js";

describe("postJSON", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts JSON and returns the parsed response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postJSON<{ ok: boolean }>({
        url: "https://example.test/messages",
        headers: { Authorization: "Bearer token" },
        body: { prompt: "hi" },
      }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://example.test/messages");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({ prompt: "hi" }),
    });
  });

  it("throws the status and response text on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "bad gateway",
        statusText: "Internal Server Error",
      } as Response),
    );

    await expect(
      postJSON({ url: "https://example.test/fail", headers: {}, body: {} }),
    ).rejects.toThrow("HTTP 500: bad gateway");
  });
});