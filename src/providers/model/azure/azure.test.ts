import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AzureModel } from "./azure.js";

describe("AzureModel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the Azure deployment URL and api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      body: null,
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const model = AzureModel.create({
      endpoint: "https://azure.example.test/",
      apiKey: "azure-key",
      deployment: "gpt-4o-deploy",
      apiVersion: "2024-02-01",
    });

    const response = await model.complete([{ role: "user", content: "hi" }]);
    expect(response.finishReason).toBe("error");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://azure.example.test/openai/deployments/gpt-4o-deploy/chat/completions?api-version=2024-02-01",
    );
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "application/json",
      "api-key": "azure-key",
    });

    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
    };
    expect(body.model).toBe("gpt-4o-deploy");
  });
});