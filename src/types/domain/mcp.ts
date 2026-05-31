// ---------------------------------------------------------------------------
// MCP server config
// ---------------------------------------------------------------------------

/**
 * McpServerConfig — configuration for a single MCP server connection.
 *
 * `transport: "stdio"` launches a local subprocess.
 * `transport: "sse"` connects to a remote server over Server-Sent Events.
 */
export type McpServerConfig = StdioMcpServerConfig | SseMcpServerConfig;

interface McpServerBase {
  serverName: string;
  /** When true, the kernel will refuse to start if this server fails to connect */
  required?: boolean;
  /**
   * Maximum number of reconnect attempts on initial connect failure.
   * Defaults to 0 (no retries — fail immediately on error).
   */
  maxReconnectAttempts?: number;
  /**
   * Delay in milliseconds between reconnect attempts.
   * Defaults to 1000.
   */
  reconnectDelayMs?: number;
}

export interface StdioMcpServerConfig extends McpServerBase {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseMcpServerConfig extends McpServerBase {
  transport: "sse";
  url: string;
}

// ---------------------------------------------------------------------------
// MCP runtime types
// ---------------------------------------------------------------------------

/**
 * McpHandle — opaque reference to a connected MCP server.
 * The kernel owns the lifecycle; callers should not hold these directly.
 */
export interface McpHandle {
  readonly serverName: string;
  readonly transport: "stdio" | "sse";
  /** @internal */
  readonly _ref: symbol;
}

/**
 * McpToolDef — a tool definition as reported by an MCP server.
 * Distinct from the SDK's own ToolDef — converted by the MCP adapter layer.
 */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
