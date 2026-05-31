import type { RunState } from "../../types/domain/run.js";
import type {
  ApprovalDecision,
  PendingApproval,
} from "../../types/domain/checkpoint.js";
import type { ToolContext } from "../../types/domain/tool.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import { routeTool } from "../tool-router/tool-router.js";

/**
 * applyDecisions — executes approved tool calls and injects synthetic
 * rejections for denied ones, appending results to `state.messages`.
 *
 * Used by the `"callback"` HITL inline path and the HITL resume path in RunSession.
 */
export async function applyDecisions(
  pendingApprovals: PendingApproval[],
  decisions: ApprovalDecision[],
  state: RunState,
  registry: ToolRegistry,
  hub: McpHub,
  toolContext: ToolContext,
): Promise<void> {
  const decisionMap = new Map(decisions.map((d) => [d.toolCallId, d]));

  for (const pa of pendingApprovals) {
    const decision = decisionMap.get(pa.toolCallId);

    if (decision?.approved) {
      const result = await routeTool(
        { id: pa.toolCallId, name: pa.name, args: pa.args },
        registry,
        hub,
        toolContext,
      );
      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: result.toolCallId,
      });
    } else {
      state.messages.push({
        role: "tool",
        content: `Tool call rejected by human reviewer.`,
        toolCallId: pa.toolCallId,
      });
    }
  }
}
