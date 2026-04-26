import { startRun } from "../../kernel/run/run.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunConfig } from "../../types/run.js";
import type { ToolDef } from "../../types/tool.js";

// ---------------------------------------------------------------------------
// AgentAsToolConfig
// ---------------------------------------------------------------------------

export interface AgentAsToolConfig {
  /**
   * Tool name exposed to the parent agent.
   * Defaults to the delegate agent's `name`.
   */
  name?: string;
  /**
   * Tool description shown to the parent model.
   * Defaults to `"Delegate to the {agentName} agent."`.
   */
  description?: string;
  /**
   * Optional RunConfig overrides applied when the sub-agent runs.
   * `onEvent` is excluded — subscribe via `AgentRouter` events instead.
   */
  runConfig?: Omit<RunConfig, "onEvent">;
}

// ---------------------------------------------------------------------------
// agentAsTool
// ---------------------------------------------------------------------------

/**
 * agentAsTool — wraps an `AgentDef` as a `ToolDef` for hierarchical delegation.
 *
 * The parent agent can invoke the sub-agent as a tool, passing a free-text
 * `input` string. The sub-agent runs to completion and returns its `response`.
 *
 * Usage:
 * ```ts
 * const coordinator = createAgent({
 *   name: "Coordinator",
 *   systemPrompt: "You coordinate specialist agents.",
 *   tools: [
 *     agentAsTool(researchAgent),
 *     agentAsTool(billingAgent, { description: "Handle billing questions." }),
 *   ],
 * });
 * ```
 */
export function agentAsTool(agent: AgentDef, config: AgentAsToolConfig = {}): ToolDef {
  const name = config.name ?? agent.name;
  const description = config.description ?? `Delegate to the ${agent.name} agent.`;
  const runConfig = config.runConfig ?? {};

  return {
    name,
    description,
    schema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: `Message to send to the ${agent.name} agent.`,
        },
      },
      required: ["input"],
    },
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const input = typeof args.input === "string" ? args.input : String(args.input ?? "");
      const result = await startRun(agent, input, runConfig);
      return result.response;
    },
  };
}
