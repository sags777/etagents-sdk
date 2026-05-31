import type { ToolCall, ToolResult } from "../../types/domain/message.js";
import type { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { ToolContext } from "../../types/domain/tool.js";
import { executeTool } from "../../agent/tool-executor.js";
import { toolCacheKey } from "../keys.js";
import { MCP_NAMESPACE_SEPARATOR } from "../../lib/constants.js";

// ---------------------------------------------------------------------------
// routeTool — dispatches a single tool call to local or MCP handler
// ---------------------------------------------------------------------------

/**
 * routeTool — resolves and executes a tool call, returning a `ToolResult`.
 *
 * Routing logic:
 *   - Names starting with `mcp__` → MCP tool via `hub.callTool()`
 *   - All other names → local tool via `executeTool()`
 *
 * For local tools with `cache.enabled`, the result is read from / written to
 * the agent's `StoreProvider` (when `context.store` is available).
 *
 * Never throws. Returns `{ isError: true }` when the tool is unknown or
 * the execution fails.
 */
// ---------------------------------------------------------------------------
// TimedToolResult — routeTool result paired with wall-clock execution time
// ---------------------------------------------------------------------------

export interface TimedToolResult {
  result: ToolResult;
  durationMs: number;
  isFromCache: boolean;
}

interface RoutedToolResult extends ToolResult {
  isFromCache: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_NAMESPACE_SEPARATOR);
}

function normalizeRawOutput(raw: unknown): string {
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

function buildRoutedResult(
  toolCallId: string,
  content: string,
  isError: boolean,
  isFromCache: boolean,
): RoutedToolResult {
  return { toolCallId, content, isError, isFromCache };
}

/**
 * routeToolTimed — executes a tool call and returns the result together with
 * the wall-clock duration of the execution. Timing starts before routing and
 * stops once the result (or error) is returned, including cache hits.
 */
export async function routeToolTimed(
  call: ToolCall,
  registry: ToolRegistry,
  hub: McpHub,
  context: ToolContext,
): Promise<TimedToolResult> {
  const start = Date.now();
  const result = await routeTool(call, registry, hub, context);
  return {
    result,
    durationMs: Date.now() - start,
    isFromCache: result.isFromCache,
  };
}

export async function routeTool(
  call: ToolCall,
  registry: ToolRegistry,
  hub: McpHub,
  context: ToolContext,
): Promise<RoutedToolResult> {
  const isMcp = isMcpTool(call.name);

  if (isMcp) {
    try {
      const raw = await hub.callTool(call.name, call.args);
      return buildRoutedResult(call.id, normalizeRawOutput(raw), false, false);
    } catch (err) {
      return buildRoutedResult(
        call.id,
        err instanceof Error ? err.message : String(err),
        true,
        false,
      );
    }
  }

  const def = registry.get(call.name);
  if (!def) {
    return buildRoutedResult(call.id, `Unknown tool: "${call.name}"`, true, false);
  }

  // Tool-result cache check — key scoped by agentId to prevent cross-agent pollution.
  const store = context.store;
  const useCache = def.cache?.enabled && store != null;
  const key = useCache
    ? toolCacheKey(context.agentId ?? context.agentName, call.name, call.args)
    : "";

  if (useCache) {
    try {
      const cached = await store!.read<string>(key);
      if (cached !== null) {
        return buildRoutedResult(call.id, cached, false, true);
      }
    } catch {
      // Cache read failure is non-fatal — proceed to execute
    }
  }

  const exec = await executeTool(def, call.args, context);

  // Write to cache on success
  if (useCache && !exec.isError) {
    void store!
      .write(key, exec.output, { ttlMs: def.cache?.ttlMs })
      .catch(() => {
        // Cache write failure is non-fatal
      });
  }

  return buildRoutedResult(call.id, exec.output, exec.isError, false);
}
