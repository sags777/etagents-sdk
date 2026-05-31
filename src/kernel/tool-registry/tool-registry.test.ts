import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { McpToolDef } from "../../types/domain/mcp.js";
import { McpHub } from "../mcp-hub/mcp-hub.js";
import { ToolRegistry } from "./tool-registry.js";

function makeHub(tools: McpToolDef[], result: unknown) {
  const hub = Object.create(McpHub.prototype) as McpHub;
  const callToolSpy = vi.fn(async (_name: string, _args: unknown) => result);
  hub.tools = () => tools;
  hub.callTool = callToolSpy;
  return { hub, callToolSpy };
}

describe("ToolRegistry", () => {
  it("registers agent-local tools", async () => {
    const localTool = defineTool({
      name: "echo",
      description: "echoes",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => msg,
    });
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
      tools: [localTool],
    });
    const { hub } = makeHub([], "unused");

    const registry = await ToolRegistry.build(agent, hub);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("echo")).toBe(localTool);
  });

  it("lets agent tools override MCP tools with the same name", async () => {
    const localTool = defineTool({
      name: "mcp__browser__navigate",
      description: "local override",
      params: z.object({}),
      handler: async () => "local",
    });
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
      tools: [localTool],
    });
    const { hub, callToolSpy } = makeHub(
      [
        {
          name: "mcp__browser__navigate",
          description: "remote tool",
          inputSchema: { type: "object" },
        },
      ],
      "remote",
    );

    const registry = await ToolRegistry.build(agent, hub);
    const tool = registry.get("mcp__browser__navigate");

    expect(await tool?.handler({})).toBe("local");
    expect(callToolSpy).not.toHaveBeenCalled();
  });

  it("proxies MCP tools through the hub and stringifies object results", async () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
      toolTruncation: {
        mcp__browser__lookup: { maxChars: 32, suffix: "..." },
      },
    });
    const { hub, callToolSpy } = makeHub(
      [
        {
          name: "mcp__browser__lookup",
          description: "remote tool",
          inputSchema: { type: "object" },
        },
      ],
      { ok: true },
    );

    const registry = await ToolRegistry.build(agent, hub);
    const tool = registry.get("mcp__browser__lookup");

    expect(await tool?.handler({ url: "https://example.com" })).toBe(
      JSON.stringify({ ok: true }),
    );
    expect(tool?.outputTruncation).toEqual({ maxChars: 32, suffix: "..." });
    expect(callToolSpy).toHaveBeenCalledWith("mcp__browser__lookup", {
      url: "https://example.com",
    });
  });
});