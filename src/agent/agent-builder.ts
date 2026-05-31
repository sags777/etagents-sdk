import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { ModelProvider } from "../contracts/model.js";
import type { AgentConfig, AgentDef } from "../types/agent.js";
import type { ToolDef, JsonSchema } from "../types/tool.js";
import { DEFAULT_CONFIG } from "../config.js";
import { ModelError } from "../errors.js";
import { MODEL_PREFIX_MAP, HITL_DEFAULT_MODE } from "../constants.js";
import { AnthropicModel } from "../providers/model/anthropic/anthropic.js";
import { OpenAIModel } from "../providers/model/openai/openai.js";
import { GeminiModel } from "../providers/model/gemini/gemini.js";
import {
  NO_OP_MEMORY,
  NO_OP_STORE,
  NO_OP_PRIVACY,
} from "../providers/no-op/index.js";

// ---------------------------------------------------------------------------
// Internal model resolution helpers
// ---------------------------------------------------------------------------

/**
 * Decompose a model string into { provider, modelId } using MODEL_PREFIX_MAP.
 * Returns undefined provider when the string does not match a known prefix.
 */
function decomposeModel(id: string): {
  provider: string | undefined;
  modelId: string;
} {
  if (id.startsWith(MODEL_PREFIX_MAP.ANTHROPIC))
    return { provider: "anthropic", modelId: id };
  if (id.startsWith(MODEL_PREFIX_MAP.OPENAI_GPT))
    return { provider: "openai", modelId: id };
  if (
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_O1) ||
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_O3) ||
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_O4)
  ) {
    return { provider: "openai", modelId: id };
  }
  if (id.startsWith(MODEL_PREFIX_MAP.GEMINI))
    return { provider: "gemini", modelId: id };
  return { provider: undefined, modelId: id };
}

/**
 * Resolve a ModelProvider instance or string shorthand to a live ModelProvider.
 *
 * String model IDs are matched by prefix:
 *   - `claude-*`                     → AnthropicModel (ANTHROPIC_API_KEY)
 *   - `gpt-*`                        → OpenAIModel    (OPENAI_API_KEY)
 *   - `o1*` / `o3*` / `o4*`         → OpenAIModel    (OPENAI_API_KEY)
 *   - `gemini-*`                     → GeminiModel    (GEMINI_API_KEY)
 */
function resolveModelProvider(model: ModelProvider | string | undefined): {
  instance: ModelProvider;
  provider?: string;
  modelId?: string;
} {
  if (model !== undefined && typeof model !== "string") {
    // Caller supplied a live provider — decompose not possible.
    return { instance: model };
  }

  const id = typeof model === "string" ? model : DEFAULT_CONFIG.defaultModel;
  const { provider, modelId } = decomposeModel(id);

  if (id.startsWith(MODEL_PREFIX_MAP.ANTHROPIC)) {
    return {
      instance: AnthropicModel.create({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        model: id,
      }),
      provider,
      modelId,
    };
  }

  if (
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_GPT) ||
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_O1) ||
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_O3) ||
    id.startsWith(MODEL_PREFIX_MAP.OPENAI_O4)
  ) {
    return {
      instance: new OpenAIModel({
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: id,
      }),
      provider,
      modelId,
    };
  }

  if (id.startsWith(MODEL_PREFIX_MAP.GEMINI)) {
    return {
      instance: GeminiModel.create({
        apiKey: process.env.GEMINI_API_KEY ?? "",
        model: id,
      }),
      provider,
      modelId,
    };
  }

  throw new ModelError(
    `Unrecognized model string "${id}". ` +
      `Supported prefixes: claude-* (ANTHROPIC_API_KEY), gpt-* / o1* / o3* / o4* (OPENAI_API_KEY), gemini-* (GEMINI_API_KEY). ` +
      `To use a custom model, pass a ModelProvider instance instead of a string.`,
  );
}

// ---------------------------------------------------------------------------
// Agent builder
// ---------------------------------------------------------------------------

/**
 * Agent — copy-on-write builder for agent configuration.
 *
 * Accumulates configuration and emits a frozen `AgentDef` via `build()`.
 * Every mutating method (`withTool`, `withModel`, etc.) returns a new `Agent`
 * instance so the original is never modified — safe to use as a base template.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ name: "my-agent", systemPrompt: "You are helpful." })
 *   .withModel("claude-sonnet-4-6")
 *   .withTool(myTool)
 *   .build();
 * ```
 */
export class Agent {
  private readonly config: AgentConfig;

  private constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Create a new `Agent` builder from an `AgentConfig`.
   *
   * @param config - Agent configuration. `name` and `systemPrompt` are required.
   */
  static create(config: AgentConfig): Agent {
    return new Agent(config);
  }

  /** Append a single tool to the agent's tool list. */
  withTool(tool: ToolDef): Agent {
    return new Agent({
      ...this.config,
      tools: [...(this.config.tools ?? []), tool],
    });
  }

  /**
   * Replace the agent's tool list entirely.
   *
   * @param tools - New tool list.
   */
  withTools(tools: ToolDef[]): Agent {
    return new Agent({ ...this.config, tools });
  }

  /**
   * Override the model.
   *
   * @param model - `ModelProvider` instance or string shorthand (e.g. `"claude-sonnet-4-6"`).
   */
  withModel(model: ModelProvider | string): Agent {
    return new Agent({ ...this.config, model });
  }

  /** Override the system prompt. */
  withSystemPrompt(prompt: string): Agent {
    return new Agent({ ...this.config, systemPrompt: prompt });
  }

  /**
   * Derive a new `Agent` by applying partial config overrides.
   * Useful for multi-tenant scenarios where most config is shared.
   *
   * @param overrides - Partial `AgentConfig` to merge over the current config.
   */
  derive(overrides: Partial<AgentConfig> = {}): Agent {
    return new Agent({ ...this.config, ...overrides });
  }

  /**
   * Build and return a serialisable manifest of this agent's public API surface.
   * Does not generate an `agentId` — use `build()` for runtime use.
   */
  toManifest(): AgentManifest {
    return agentToManifest(this.buildDef());
  }

  /**
   * Resolve all config defaults and return a frozen `AgentDef` ready for the kernel.
   *
   * - Generates a fresh `agentId` (nanoid) — stable for this build call.
   * - Computes `systemPromptHash` (SHA-256 hex of `systemPrompt`).
   * - Decomposes `model` string into `modelProvider` + `modelId` when possible.
   * - Fills all optional providers with no-op defaults.
   */
  build(): AgentDef {
    return Object.freeze(this.buildDef());
  }

  /** The current accumulated config — read-only snapshot. */
  get currentConfig(): Readonly<AgentConfig> {
    return this.config;
  }

  private buildDef(): AgentDef {
    const { config } = this;

    const resolved = resolveModelProvider(config.model);
    const systemPromptHash = crypto
      .createHash("sha256")
      .update(config.systemPrompt)
      .digest("hex");

    return {
      agentId: nanoid(),
      name: config.name,
      systemPrompt: config.systemPrompt,
      systemPromptHash,
      modelProvider: resolved.provider,
      modelId: resolved.modelId,
      tools: config.tools ?? [],
      description: config.description,
      version: config.version,

      model: resolved.instance,
      memory: config.memory ?? NO_OP_MEMORY,
      store: config.store ?? NO_OP_STORE,
      privacy: config.privacy ?? NO_OP_PRIVACY,

      insight: config.insight ?? {},
      hitl: config.hitl ?? { mode: HITL_DEFAULT_MODE },
      hooks: config.hooks ?? {},
      mcp: config.mcp ?? [],

      maxTurns: config.maxTurns ?? DEFAULT_CONFIG.maxTurns,
      maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
      memoryRetrieval: {
        minScore: config.memoryRetrieval?.minScore ?? DEFAULT_CONFIG.memoryMinScore,
        topK: config.memoryRetrieval?.topK,
        budget: config.memoryRetrieval?.budget,
      },
      toolTruncation: config.toolTruncation,
    };
  }
}

// ---------------------------------------------------------------------------
// Manifest
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

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * createAgent — validates config and returns a frozen `AgentDef`.
 *
 * Thin wrapper around `Agent.create(config).build()`. Prefer `Agent` directly
 * when using the builder pattern (e.g. `withTool`, `withModel`, `derive`).
 *
 * - `config.model` may be a `ModelProvider` instance or a string shorthand
 *   (e.g. `"claude-sonnet-4-6"`). When omitted the default model from
 *   `DEFAULT_CONFIG` is used.
 * - All other providers default to no-op implementations when omitted.
 * - The returned `AgentDef` is frozen — callers cannot mutate it after creation.
 */
export function createAgent(config: AgentConfig): AgentDef {
  return Agent.create(config).build();
}

/**
 * cloneAgent — produce a new `AgentDef` from an existing one with selective overrides.
 *
 * Useful for multi-tenant scenarios where most config is shared but one or two
 * providers (model, store, privacy) differ per request.
 *
 * All resolved providers from `base` are carried forward unless explicitly
 * replaced in `overrides`. The returned `AgentDef` is a new frozen object —
 * `base` is never mutated.
 *
 * @example
 * // Swap only the model for a cheaper tier
 * const fastAgent = cloneAgent(agent, { model: "claude-haiku-4-5-20251001" });
 *
 * @example
 * // Tenant-scoped store and privacy — everything else inherited
 * const tenantAgent = cloneAgent(baseAgent, { store: tenantStore, privacy: tenantPrivacy });
 */
export function cloneAgent(
  base: AgentDef,
  overrides: Partial<AgentConfig> = {},
): AgentDef {
  return createAgent({ ...base, ...overrides } as AgentConfig);
}
