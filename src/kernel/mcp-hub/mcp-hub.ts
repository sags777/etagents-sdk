import { McpClient } from "../../mcp/client/client.js";
import type { McpServerConfig, McpHandle, McpToolDef } from "../../types/mcp.js";

// ---------------------------------------------------------------------------
// McpHub — connects to all configured MCP servers and aggregates their tools
// ---------------------------------------------------------------------------

/**
 * McpHub — manages multiple MCP server connections for a single run.
 *
 * `McpHub.connect()` is called at run start; `disconnect()` is called in
 * the `finally` block so transports are always cleaned up.
 *
 * Tool names from each server are already namespaced `{serverName}::{tool}`
 * by the underlying `McpClient`.
 */
export class McpHub {
  private readonly client: McpClient;
  private readonly handles: McpHandle[] = [];
  private readonly toolIndex = new Map<string, McpHandle>();
  private readonly allTools: McpToolDef[] = [];

  private constructor() {
    this.client = new McpClient();
  }

  static async connect(configs: McpServerConfig[]): Promise<McpHub> {
    const hub = new McpHub();
    await Promise.all(
      configs.map(async (cfg) => {
        const handle = await hub.client.connect(cfg);
        hub.handles.push(handle);
        const tools = await hub.client.listTools(handle);
        for (const t of tools) {
          hub.allTools.push(t);
          hub.toolIndex.set(t.name, handle);
        }
      }),
    );
    return hub;
  }

  /** All tools from all connected servers. */
  tools(): McpToolDef[] {
    return [...this.allTools];
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const handle = this.toolIndex.get(name);
    if (!handle) throw new Error(`McpHub: unknown tool "${name}"`);
    return this.client.callTool(handle, name, args as Record<string, unknown>);
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.handles.map((h) => this.client.disconnect(h)));
  }
}
