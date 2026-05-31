import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("redis", () => ({
  createClient: createClientMock,
}));

import { createRedisClient } from "./client.js";

interface MockClient {
  on: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

describe("createRedisClient", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      on: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue(undefined),
    };
    createClientMock.mockReset();
    createClientMock.mockReturnValue(client as unknown as RedisClientType);
  });

  it("creates a client, registers an error handler, and connects", async () => {
    const result = await createRedisClient("redis://example.test:6379");

    expect(createClientMock).toHaveBeenCalledWith({
      url: "redis://example.test:6379",
    });
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client.connect).toHaveBeenCalledOnce();
    expect(result).toBe(client);

    const errorHandler = client.on.mock.calls[0]?.[1] as
      | ((error: Error) => void)
      | undefined;
    expect(() => errorHandler?.(new Error("boom"))).not.toThrow();
  });

  it("allows an undefined url", async () => {
    await createRedisClient();
    expect(createClientMock).toHaveBeenCalledWith({ url: undefined });
  });
});