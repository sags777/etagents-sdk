import type { ToolCall, ToolResult } from "../../types/message.js";
import type { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { ToolContext } from "../../agent/executor/executor.js";
import { executeTool } from "../../agent/executor/executor.js";

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

  const exec = await executeTool(def, call.args, context);
  return {
    toolCallId: call.id,
    content: exec.output,
    isError: exec.isError,
  };
}
