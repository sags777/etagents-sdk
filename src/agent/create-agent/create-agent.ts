import type { ModelProvider } from "../../interfaces/model.js";
import type { MemoryProvider } from "../../interfaces/memory.js";
import type { StoreProvider } from "../../interfaces/store.js";
import type { PrivacyProvider, PrivacyMap } from "../../interfaces/privacy.js";
import type { AgentConfig, AgentDef } from "../../types/agent.js";
import { DEFAULT_CONFIG } from "../../config.js";
import { AnthropicModel } from "../../providers/model/anthropic/anthropic.js";
import { OpenAIModel } from "../../providers/model/openai/openai.js";
import { GeminiModel } from "../../providers/model/gemini/gemini.js";

// ---------------------------------------------------------------------------
// No-op provider defaults
// ---------------------------------------------------------------------------

const NO_OP_MEMORY: MemoryProvider = {
  async index() {},
  async search() {
    return [];
  },
  async delete() {},
  async clear() {},
};

const NO_OP_STORE: StoreProvider = {
  async read() {
    return null;
  },
  async write() {},
  async remove() {},
  async list() {
    return [];
  },
};

const NO_OP_PRIVACY: PrivacyProvider = {
  async mask(text) {
    return { masked: text, map: new Map<string, string>() };
  },
  async unmask(text) {
    return text;
  },
  async encryptMap(map: PrivacyMap) {
    return { iv: "", ciphertext: JSON.stringify([...map]) };
  },
  async decryptMap(enc) {
    return new Map<string, string>(JSON.parse(enc.ciphertext) as [string, string][]);
  },
};

// ---------------------------------------------------------------------------
// Model shorthand resolution
// ---------------------------------------------------------------------------

/**
 * Model shorthand resolution table.
 *
 * String model IDs are matched by prefix and resolved to a ModelProvider
 * instance using the corresponding API key from the environment.
 *
 * Supported prefixes:
 *   - `claude-*`   → AnthropicModel (ANTHROPIC_API_KEY)
 *   - `gpt-*`      → OpenAIModel    (OPENAI_API_KEY)
 *   - `o1*`/`o3*`  → OpenAIModel    (OPENAI_API_KEY)
 *   - `gemini-*`   → GeminiModel    (GEMINI_API_KEY)
 */
function resolveModel(model: ModelProvider | string | undefined): ModelProvider {
  if (model !== undefined && typeof model !== "string") return model;

  const id = typeof model === "string" ? model : DEFAULT_CONFIG.defaultModel;

  if (id.startsWith("claude-")) {
    return AnthropicModel.create({
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: id,
    });
  }

  if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3")) {
    return new OpenAIModel({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: id,
    });
  }

  if (id.startsWith("gemini-")) {
    return GeminiModel.create({
      apiKey: process.env.GEMINI_API_KEY ?? "",
      model: id,
    });
  }

  throw new Error(
    `Unrecognised model shorthand: "${id}". Pass a ModelProvider instance or a known model ID (claude-*, gpt-*, gemini-*).`,
  );
}

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

/**
 * createAgent — validates config and returns a frozen `AgentDef`.
 *
 * - `config.model` may be a `ModelProvider` instance or a string shorthand
 *   (e.g. `"claude-sonnet-4-6"`). When omitted the default model from
 *   `DEFAULT_CONFIG` is used.
 * - All other providers default to no-op implementations when omitted.
 * - The returned `AgentDef` is frozen — callers cannot mutate it after creation.
 */
export function createAgent(config: AgentConfig): AgentDef {
  const def: AgentDef = {
    name: config.name,
    systemPrompt: config.systemPrompt,
    tools: config.tools ?? [],

    model: resolveModel(config.model),
    memory: config.memory ?? NO_OP_MEMORY,
    store: config.store ?? NO_OP_STORE,
    privacy: config.privacy ?? NO_OP_PRIVACY,

    insight: config.insight ?? {},
    hitl: config.hitl ?? { mode: "none" },
    hooks: config.hooks ?? {},
    mcp: config.mcp ?? [],

    maxTurns: config.maxTurns ?? DEFAULT_CONFIG.maxTurns,
    maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
  };

  return Object.freeze(def);
}
