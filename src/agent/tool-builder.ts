import { z } from "zod";
import { startRun } from "../kernel/entry/start.js";
import type { AgentDef } from "../types/agent.js";
import type { RunConfig } from "../types/run.js";
import type {
  ToolConfig,
  ToolDef,
  JsonSchema,
  ToolContext,
} from "../types/tool.js";
import { ToolError } from "../errors.js";

// ---------------------------------------------------------------------------
// AgentAsToolConfig
// ---------------------------------------------------------------------------

export interface AgentAsToolConfig {
  /** Tool name exposed to the parent agent. Defaults to the delegate agent's `name`. */
  name?: string;
  /** Tool description shown to the parent model. Defaults to `"Delegate to the {agentName} agent."`. */
  description?: string;
  /** Optional RunConfig overrides applied when the sub-agent runs. `onEvent` is excluded — subscribe via `AgentRouter` events instead. */
  runConfig?: Omit<RunConfig, "onEvent">;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * zodToJsonSchema — converts a Zod v4 schema to a JSON Schema Draft 7 object.
 *
 * Delegates to Zod's built-in `toJSONSchema()` and strips the Draft 2020-12
 * `$schema` annotation so callers receive a plain, provider-compatible schema.
 */
function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  if (
    !("toJSONSchema" in schema) ||
    typeof (schema as { toJSONSchema?: unknown }).toJSONSchema !== "function"
  ) {
    throw new ToolError(
      "Zod schema does not expose toJSONSchema() — upgrade to Zod v4 or later",
    );
  }
  const raw = (
    schema as unknown as { toJSONSchema(): Record<string, unknown> }
  ).toJSONSchema();
  const { $schema: _drop, ...rest } = raw;
  return rest as JsonSchema;
}

// ---------------------------------------------------------------------------
// Tool builder
// ---------------------------------------------------------------------------

/**
 * Tool — copy-on-write builder for tool configuration.
 *
 * Accumulates configuration and emits a frozen `ToolDef` via `toToolDef()`.
 * Every mutating method returns a new `Tool` instance — the original is never
 * modified, so a base `Tool` can be shared across multiple agents.
 *
 * @example
 * ```ts
 * const myTool = Tool.create({
 *   name: "get_weather",
 *   description: "Return current weather for a city.",
 *   params: z.object({ city: z.string() }),
 *   handler: async ({ city }) => `Sunny in ${city}`,
 * }).withCache({ enabled: true, ttl: 60 }).toToolDef();
 * ```
 */
export class Tool<T extends z.ZodType = z.ZodType> {
  private readonly config: ToolConfig<T>;

  private constructor(config: ToolConfig<T>) {
    this.config = config;
  }

  /**
   * Create a new `Tool` builder from a `ToolConfig`.
   *
   * @param config - Tool configuration. `name`, `description`, `params`, and `handler` are required.
   */
  static create<T extends z.ZodType>(config: ToolConfig<T>): Tool<T> {
    return new Tool(config);
  }

  /** Wrap an `AgentDef` as a `ToolDef` for hierarchical delegation. */
  static fromAgent(
    agent: AgentDef,
    config: AgentAsToolConfig = {},
  ): ToolDef {
    const name = config.name ?? agent.name;
    const description =
      config.description ?? `Delegate to the ${agent.name} agent.`;
    const runConfig = config.runConfig ?? {};

    return Tool.create({
      name,
      description,
      params: z.object({
        input: z.coerce
          .string()
          .describe(`Message to send to the ${agent.name} agent.`),
      }),
      handler: async ({ input }) => {
        const result = await startRun(agent, input, runConfig);
        return result.response;
      },
    }).toToolDef();
  }

  /**
   * Override the tool's execution timeout.
   *
   * @param ms - Timeout in milliseconds.
   */
  withTimeout(ms: number): Tool<T> {
    return new Tool({ ...this.config, timeoutMs: ms });
  }

  /**
   * Configure result caching.
   *
   * @param config - `ttl` is in seconds; `ttlMs` is in milliseconds. `ttl` takes precedence.
   */
  withCache(config: {
    enabled: boolean;
    ttl?: number;
    ttlMs?: number;
  }): Tool<T> {
    return new Tool({ ...this.config, cache: config });
  }

  /** Mark the tool as sensitive — requires HITL approval when `mode: "sensitive"`. */
  sensitive(): Tool<T> {
    return new Tool({ ...this.config, sensitive: true });
  }

  /**
   * Resolve all config defaults and return a `ToolDef` ready for the kernel.
   *
   * The returned handler validates incoming args through the Zod schema before
   * forwarding them to the user's handler — runtime arg errors surface as `ToolError`.
   */
  toToolDef(): ToolDef {
    const {
      name,
      description,
      params,
      handler,
      sequential,
      timeoutMs,
      sensitive,
      cache,
      outputTruncation,
    } = this.config;

    const schema = zodToJsonSchema(params);

    const wrappedHandler = async (
      rawArgs: Record<string, unknown>,
      context?: ToolContext,
    ): Promise<string> => {
      const result = params.safeParse(rawArgs);
      if (!result.success) {
        throw new ToolError(
          `Invalid arguments for tool "${name}": ${result.error.message}`,
        );
      }
      return handler(result.data as z.infer<T>, context);
    };

    return {
      name,
      description,
      schema,
      handler: wrappedHandler,
      sequential,
      timeout: timeoutMs,
      sensitive,
      cache: cache
        ? {
            enabled: cache.enabled,
            ttlMs: cache.ttl != null ? cache.ttl * 1000 : cache.ttlMs,
          }
        : undefined,
      outputTruncation,
    };
  }

  /** The current accumulated config — read-only snapshot. */
  get currentConfig(): Readonly<ToolConfig<T>> {
    return this.config;
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * defineTool — creates a typed `ToolDef` from a Zod-parametrised config.
 *
 * Thin wrapper around `Tool.create(config).toToolDef()`. Prefer `Tool` directly
 * when using the builder pattern (e.g. `withTimeout`, `withCache`, `sensitive`).
 *
 * The returned handler validates incoming args through the Zod schema before
 * forwarding them to the user's handler, so runtime arg errors surface as
 * `ToolError` rather than obscure type coercion bugs.
 */
export function defineTool<T extends z.ZodType>(
  config: ToolConfig<T>,
): ToolDef {
  return Tool.create(config).toToolDef();
}

/**
 * agentAsTool — wraps an `AgentDef` as a `ToolDef` for hierarchical delegation.
 *
 * The parent agent can invoke the sub-agent as a tool, passing a free-text
 * `input` string. The sub-agent runs to completion and returns its `response`.
 */
export function agentAsTool(
  agent: AgentDef,
  config: AgentAsToolConfig = {},
): ToolDef {
  return Tool.fromAgent(agent, config);
}
