/**
 * @module cli/loader
 *
 * Dynamic agent-file loader for the `eta` CLI.
 * Agent files must default-export an AgentDef (created via createAgent).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
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
    mod = await importAgentModule(resolved);
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

async function importAgentModule(resolved: string): Promise<{ default?: unknown }> {
  try {
    return (await import(pathToFileURL(resolved).href)) as { default?: unknown };
  } catch (err) {
    if (!isTypescriptAgentFile(resolved)) throw err;
    return transpileAndImport(resolved);
  }
}

function isTypescriptAgentFile(resolved: string): boolean {
  return /\.(cts|mts|ts|tsx)$/i.test(resolved);
}

async function transpileAndImport(resolved: string): Promise<{ default?: unknown }> {
  const source = await fs.readFile(resolved, "utf-8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
      verbatimModuleSyntax: true,
    },
    fileName: resolved,
    reportDiagnostics: true,
  });

  if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
    const message = ts.formatDiagnosticsWithColorAndContext(transpiled.diagnostics, {
      getCurrentDirectory: () => path.dirname(resolved),
      getCanonicalFileName: (fileName) => fileName,
      getNewLine: () => "\n",
    }).trim();
    throw new Error(message || `Failed to transpile TypeScript agent file: ${resolved}`);
  }

  const tempFile = path.join(
    path.dirname(resolved),
    `.eta-${path.basename(resolved, path.extname(resolved))}.${process.pid}.${Date.now()}.mjs`,
  );

  await fs.writeFile(tempFile, transpiled.outputText, "utf-8");

  try {
    return (await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)) as { default?: unknown };
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
  }
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
    `Unrecognised model shorthand: "${modelId}". Supported prefixes: claude-*, gpt-*, o1*, o3*, gemini-*. For other providers such as Azure, construct the provider in the agent file and omit --model.`,
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
