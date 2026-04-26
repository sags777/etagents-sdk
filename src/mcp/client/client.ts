import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig, McpHandle, McpToolDef } from "../../types/mcp.js";
import { McpError } from "../../errors.js";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface ServerEntry {
  config: McpServerConfig;
  client?: Client;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

/**
 * McpClient — manages connections to external MCP servers.
 *
 * Connections are lazy: the underlying transport is not established until the
 * first `listTools()` or `callTool()` call on that handle.
 *
 * Tool names are namespaced as `{serverName}::{toolName}` to prevent collisions
 * across multiple connected servers.
 */
export class McpClient {
  private readonly registry = new Map<symbol, ServerEntry>();

  /**
   * Registers an MCP server config and returns an opaque handle.
   * No network connection is made at this point.
   */
  async connect(config: McpServerConfig): Promise<McpHandle> {
    const ref = Symbol(config.serverName);
    this.registry.set(ref, { config });
    return { serverName: config.serverName, transport: config.transport, _ref: ref };
  }

  /**
   * Connects the underlying MCP Client if not already connected.
   * Retries up to `config.maxReconnectAttempts` times with `config.reconnectDelayMs` delay.
   * All I/O errors are wrapped in `McpError`.
   */
  private async ensureConnected(handle: McpHandle): Promise<Client> {
    const entry = this.registry.get(handle._ref);
    if (!entry) {
      throw new McpError(`Unknown handle for server "${handle.serverName}" — was it registered with connect()?`);
    }

    if (entry.client) return entry.client;

    const maxAttempts = (entry.config.maxReconnectAttempts ?? 0) + 1;
    const delayMs = entry.config.reconnectDelayMs ?? 1000;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const client = new Client({ name: "eta-mcp-client", version: "0.0.1" });

      const transport =
        entry.config.transport === "stdio"
          ? new StdioClientTransport({
              command: entry.config.command,
              args: entry.config.args,
              env: entry.config.env,
            })
          : new SSEClientTransport(new URL(entry.config.url));

      try {
        await client.connect(transport);
        entry.client = client;
        return client;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new McpError(
      `Failed to connect to MCP server "${handle.serverName}" after ${maxAttempts} attempt(s): ${String(lastError)}`,
      { cause: lastError },
    );
  }

  /**
   * Returns all tools exposed by the server, with names prefixed
   * `{serverName}::{toolName}`.
   */
  async listTools(handle: McpHandle): Promise<McpToolDef[]> {
    try {
      const client = await this.ensureConnected(handle);
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: `${handle.serverName}::${t.name}`,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(
        `listTools failed for "${handle.serverName}": ${String(err)}`,
        { cause: err },
      );
    }
  }

  /**
   * Calls a tool by namespaced name (`{serverName}::{toolName}` or bare tool name).
   * Returns the concatenated text content from the tool result.
   */
  async callTool(
    handle: McpHandle,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const prefix = `${handle.serverName}::`;
    const toolName = name.startsWith(prefix) ? name.slice(prefix.length) : name;

    try {
      const client = await this.ensureConnected(handle);
      const raw = await client.callTool({ name: toolName, arguments: args });
      const content = raw.content as Array<{ type: string; text?: string }>;
      const texts = content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text);
      return texts.length > 0 ? texts.join("\n") : content;
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(`callTool "${name}" failed: ${String(err)}`, { cause: err });
    }
  }

  /**
   * Closes the connection and removes the handle from the registry.
   * Safe to call on an unconnected or already-disconnected handle.
   */
  async disconnect(handle: McpHandle): Promise<void> {
    const entry = this.registry.get(handle._ref);
    if (!entry) return;

    if (entry.client) {
      try {
        await entry.client.close();
      } catch {
        // Best-effort — ignore close errors
      }
    }

    this.registry.delete(handle._ref);
  }
}
