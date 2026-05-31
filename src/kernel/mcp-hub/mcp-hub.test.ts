import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClient } from "../../mcp/client/client.js";
import type { McpHandle } from "../../types/domain/mcp.js";
import { McpHub } from "./mcp-hub.js";

function makeHandle(
  serverName: string,
  transport: McpHandle["transport"],
): McpHandle {
  return { serverName, transport, _ref: Symbol(serverName) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpHub", () => {
  it("aggregates connected tools and routes calls by namespaced tool name", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async (config) =>
      makeHandle(config.serverName, config.transport),
    );
    vi.spyOn(McpClient.prototype, "listTools").mockImplementation(async (handle) => [
      {
        name: `mcp__${handle.serverName}__lookup`,
        description: `${handle.serverName} lookup`,
        inputSchema: { type: "object" },
      },
    ]);
    const callToolSpy = vi
      .spyOn(McpClient.prototype, "callTool")
      .mockImplementation(async (handle, name) => `${handle.serverName}:${name}`);
    const disconnectSpy = vi
      .spyOn(McpClient.prototype, "disconnect")
      .mockResolvedValue(undefined);

    const hub = await McpHub.connect([
      { serverName: "alpha", transport: "stdio", command: "alpha" },
      { serverName: "beta", transport: "sse", url: "https://example.com/sse" },
    ]);

    expect(hub.tools().map((tool) => tool.name)).toEqual([
      "mcp__alpha__lookup",
      "mcp__beta__lookup",
    ]);
    await expect(hub.callTool("mcp__beta__lookup", { q: "status" })).resolves.toBe(
      "beta:mcp__beta__lookup",
    );
    expect(callToolSpy).toHaveBeenCalledOnce();

    await hub.disconnect();
    expect(disconnectSpy).toHaveBeenCalledTimes(2);
  });

  it("warns and skips tools from a server whose listing fails", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async (config) =>
      makeHandle(config.serverName, config.transport),
    );
    vi.spyOn(McpClient.prototype, "listTools").mockImplementation(async (handle) => {
      if (handle.serverName === "beta") {
        throw new Error("boom");
      }
      return [
        {
          name: "mcp__alpha__lookup",
          description: "alpha lookup",
          inputSchema: { type: "object" },
        },
      ];
    });
    vi.spyOn(McpClient.prototype, "disconnect").mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const hub = await McpHub.connect([
      { serverName: "alpha", transport: "stdio", command: "alpha" },
      { serverName: "beta", transport: "stdio", command: "beta" },
    ]);

    expect(hub.tools().map((tool) => tool.name)).toEqual(["mcp__alpha__lookup"]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to MCP server "beta"'),
    );

    await hub.disconnect();
  });

  it("throws when the requested tool is unknown", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async (config) =>
      makeHandle(config.serverName, config.transport),
    );
    vi.spyOn(McpClient.prototype, "listTools").mockResolvedValue([]);
    vi.spyOn(McpClient.prototype, "disconnect").mockResolvedValue(undefined);

    const hub = await McpHub.connect([
      { serverName: "alpha", transport: "stdio", command: "alpha" },
    ]);

    await expect(hub.callTool("mcp__alpha__missing", {})).rejects.toThrow(
      'McpHub: unknown tool "mcp__alpha__missing"',
    );

    await hub.disconnect();
  });
});