/**
 * @module cli/loader
 *
 * Dynamic agent-file loader for the `eta` CLI.
 * Agent files must default-export an AgentDef (created via createAgent).
 */

import path from "node:path";
import type { AgentDef } from "../../types/agent.js";
import type { ModelProvider } from "../../interfaces/model.js";
import { AnthropicModel } from "../../providers/model/anthropic/anthropic.js";
import { OpenAIModel } from "../../providers/model/openai/openai.js";
import { GeminiModel } from "../../providers/model/gemini/gemini.js";

/**
 * Load an agent file and return its default-exported AgentDef.
 * Exits process with an error if the file cannot be loaded or the export
 * is not an AgentDef.
 */
export async function loadAgentFile(agentFile: string): Promise<AgentDef> {
  const resolved = path.resolve(agentFile);
  let mod: { default?: unknown };
  try {
    mod = (await import(resolved)) as { default?: unknown };
  } catch (err) {
    console.error(`Error loading agent file "${agentFile}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const agent = mod.default;
  if (!agent || typeof agent !== "object" || !("name" in agent) || !("systemPrompt" in agent)) {
    console.error(
      `Error: "${agentFile}" must default-export an AgentDef created via createAgent().`,
    );
    process.exit(1);
  }

  return agent as AgentDef;
}

/**
 * Resolve a model string shorthand to a ModelProvider.
 * Mirrors the logic in createAgent — kept here so CLI commands can
 * override the agent's model without re-creating the whole AgentDef.
 */
export function resolveModel(modelId: string, apiKey?: string): ModelProvider {
  if (modelId.startsWith("claude-")) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    return AnthropicModel.create({ apiKey: key, model: modelId });
  }
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")) {
    const key = apiKey ?? process.env.OPENAI_API_KEY ?? "";
    return new OpenAIModel({ apiKey: key, model: modelId });
  }
  if (modelId.startsWith("gemini-")) {
    const key = apiKey ?? process.env.GEMINI_API_KEY ?? "";
    return GeminiModel.create({ apiKey: key, model: modelId });
  }
  throw new Error(
    `Unrecognised model shorthand: "${modelId}". Supported prefixes: claude-*, gpt-*, o1*, o3*, gemini-*`,
  );
}

/**
 * Return a new frozen AgentDef with the model field overridden.
 * Use when the CLI --model flag should take precedence over the
 * model baked into the agent file.
 */
export function withModel(agent: AgentDef, modelId: string, apiKey?: string): AgentDef {
  return Object.freeze({ ...agent, model: resolveModel(modelId, apiKey) });
}
