import type { AgentDef } from "../../types/agent.js";
import type { ToolDef, JsonSchema } from "../../types/tool.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";

// ---------------------------------------------------------------------------
// ToolRegistry — merged view of local + MCP tools
// ---------------------------------------------------------------------------

/**
 * ToolRegistry — combines agent-local tools with tools from connected MCP servers.
 *
 * Build order matters for conflict resolution:
 *   1. MCP tools are registered first.
 *   2. Agent tools overwrite on name collision (agent tools win).
 *
 * MCP tool handlers proxy calls through the hub so the registry presents a
 * uniform `ToolDef` interface regardless of tool origin.
 */
export class ToolRegistry {
  private readonly reg = new Map<string, ToolDef>();

  private constructor() {}

  static async build(agent: AgentDef, hub: McpHub): Promise<ToolRegistry> {
    const registry = new ToolRegistry();

    // Register MCP tools first
    for (const mcpTool of hub.tools()) {
      const proxy: ToolDef = {
        name: mcpTool.name,
        description: mcpTool.description,
        schema: mcpTool.inputSchema as JsonSchema,
        handler: async (args) => {
          const result = await hub.callTool(mcpTool.name, args);
          return typeof result === "string" ? result : JSON.stringify(result);
        },
      };
      registry.reg.set(proxy.name, proxy);
    }

    // Agent tools override — they win on conflict
    for (const tool of agent.tools) {
      registry.reg.set(tool.name, tool);
    }

    return registry;
  }

  list(): ToolDef[] {
    return Array.from(this.reg.values());
  }

  get(name: string): ToolDef | undefined {
    return this.reg.get(name);
  }
}
