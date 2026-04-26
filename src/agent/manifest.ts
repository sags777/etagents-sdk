import type { AgentDef } from "../types/agent.js";
import type { JsonSchema } from "../types/tool.js";

// ---------------------------------------------------------------------------
// AgentManifest
// ---------------------------------------------------------------------------

/**
 * AgentManifest — a serialisable snapshot of an agent's public API surface.
 *
 * Useful for registries, dashboards, and the `eta inspect` CLI command.
 */
export interface AgentManifest {
  name: string;
  description?: string;
  version?: string;
  systemPrompt: string;
  tools: Array<{
    name: string;
    description: string;
    schema: JsonSchema;
    sensitive?: boolean;
  }>;
  /** Model class name or `"unknown"` when introspection is not available. */
  model: string;
  maxTurns: number;
  maxTokens: number;
}

// ---------------------------------------------------------------------------
// agentToManifest
// ---------------------------------------------------------------------------

/**
 * agentToManifest — converts an `AgentDef` into a plain serialisable manifest.
 *
 * ```ts
 * const manifest = agentToManifest(myAgent);
 * console.log(JSON.stringify(manifest, null, 2));
 * ```
 */
export function agentToManifest(agent: AgentDef): AgentManifest {
  const modelName = agent.model?.constructor?.name ?? "unknown";

  return {
    name: agent.name,
    description: agent.description,
    version: agent.version,
    systemPrompt: agent.systemPrompt,
    tools: agent.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
      ...(t.sensitive ? { sensitive: true } : {}),
    })),
    model: modelName,
    maxTurns: agent.maxTurns,
    maxTokens: agent.maxTokens,
  };
}
