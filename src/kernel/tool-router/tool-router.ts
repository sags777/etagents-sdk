import type { ToolCall, ToolResult } from "../../types/message.js";
import type { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { ToolContext } from "../../agent/executor/executor.js";
import { executeTool } from "../../agent/executor/executor.js";

// ---------------------------------------------------------------------------
// Cache key helper
// ---------------------------------------------------------------------------

/**
 * Build a stable cache key from tool name + args.
 * Uses sorted JSON so `{b:1, a:2}` and `{a:2, b:1}` produce the same key.
 */
function cacheKey(toolName: string, args: Record<string, unknown>): string {
  const stable = JSON.stringify(args, Object.keys(args).sort());
  return `eta:tool-cache:${toolName}:${Buffer.from(stable).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// routeTool — dispatches a single tool call to local or MCP handler
// ---------------------------------------------------------------------------

/**
 * routeTool — resolves and executes a tool call, returning a `ToolResult`.
 *
 * Routing logic:
 *   - Names containing `::` → MCP tool via `hub.callTool()`
 *   - All other names → local tool via `executeTool()`
 *
 * For local tools with `cache.enabled`, the result is read from / written to
 * the agent's `StoreProvider` (when `context.store` is available).
 *
 * Never throws. Returns `{ isError: true }` when the tool is unknown or
 * the execution fails.
 */
export async function routeTool(
  call: ToolCall,
  registry: ToolRegistry,
  hub: McpHub,
  context: ToolContext,
): Promise<ToolResult> {
  const isMcp = call.name.includes("::");

  if (isMcp) {
    try {
      const raw = await hub.callTool(call.name, call.args);
      return {
        toolCallId: call.id,
        content: typeof raw === "string" ? raw : JSON.stringify(raw),
        isError: false,
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  }

  const def = registry.get(call.name);
  if (!def) {
    return {
      toolCallId: call.id,
      content: `Unknown tool: "${call.name}"`,
      isError: true,
    };
  }

  // Tool-result cache check
  const store = context.store;
  const useCache = def.cache?.enabled && store != null;
  const key = useCache ? cacheKey(call.name, call.args) : "";

  if (useCache) {
    try {
      const cached = await store!.read<string>(key);
      if (cached !== null) {
        return { toolCallId: call.id, content: cached, isError: false };
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

  return {
    toolCallId: call.id,
    content: exec.output,
    isError: exec.isError,
  };
}
