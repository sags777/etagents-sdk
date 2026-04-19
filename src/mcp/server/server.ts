import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "../../types/tool.js";
import { McpError } from "../../errors.js";

// ---------------------------------------------------------------------------
// McpServer
// ---------------------------------------------------------------------------

/**
 * McpServer — builder-style wrapper around the MCP low-level Server.
 *
 * Usage:
 * ```ts
 * await new McpServer({ name: "my-server", version: "1.0.0" })
 *   .addTool(searchTool)
 *   .addTool(writeTool)
 *   .start();
 * ```
 *
 * `start()` connects via stdio and blocks until the process exits.
 * Call this as the final statement in a CLI entry point.
 */
export class McpServer {
  private readonly inner: Server;
  private readonly tools = new Map<string, ToolDef>();
  private started = false;

  constructor(info: { name: string; version: string }) {
    this.inner = new Server(info, { capabilities: { tools: {} } });

    this.inner.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.schema as { type: "object"; properties?: Record<string, object>; required?: string[] },
      })),
    }));

    this.inner.setRequestHandler(CallToolRequestSchema, async (req) => {
      const def = this.tools.get(req.params.name);
      if (!def) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }],
          isError: true,
        };
      }
      try {
        const result = await def.handler(req.params.arguments ?? {});
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    });
  }

  /**
   * Registers a tool. Must be called before `start()`.
   * Returns `this` for fluent chaining.
   */
  addTool(def: ToolDef): this {
    if (this.started) throw new McpError("Cannot add tools after McpServer has started");
    this.tools.set(def.name, def);
    return this;
  }

  /**
   * Connects to stdio and starts serving MCP requests.
   * Resolves once the transport is ready.
   */
  async start(): Promise<void> {
    if (this.started) throw new McpError("McpServer is already started");
    this.started = true;
    const transport = new StdioServerTransport();
    await this.inner.connect(transport);
  }
}
