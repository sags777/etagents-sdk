import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIEmbedder } from "./embedder.js";

describe("OpenAIEmbedder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts embeddings requests with the configured model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new OpenAIEmbedder({
      apiKey: "test-key",
      model: "text-embedding-3-large",
      baseUrl: "https://example.test/v1/",
    });

    await expect(embedder.embed("hello world")).resolves.toEqual([
      0.1,
      0.2,
      0.3,
    ]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://example.test/v1/embeddings");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({
        input: "hello world",
        model: "text-embedding-3-large",
      }),
    });
  });

  it("throws a descriptive error when the API responds with failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response),
    );

    const embedder = new OpenAIEmbedder({ apiKey: "test-key" });

    await expect(embedder.embed("secret")).rejects.toThrow(
      "OpenAI embeddings error: 401 Unauthorized",
    );
  });
});