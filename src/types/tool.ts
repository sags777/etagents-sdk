import { z } from "zod";
import type { StoreProvider } from "../interfaces/store.js";
import type { Message } from "./message.js";

// ---------------------------------------------------------------------------
// JSON Schema (Draft 7 subset)
// ---------------------------------------------------------------------------

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  /** Allow additional Draft 7 keywords without breaking the type */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * ToolDef — the full specification for a tool the agent can invoke.
 *
 * `sequential` prevents concurrent invocation of this tool with others.
 * `timeout` overrides DEFAULT_CONFIG.toolTimeoutMs for this specific tool.
 * `sensitive` causes HITL `mode: "sensitive"` to require approval before running.
 * `cache` enables kernel-level result caching backed by the agent's StoreProvider.
 */
export interface ToolDef<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  schema: JsonSchema;
  handler: (args: TArgs) => Promise<string>;
  sequential?: boolean;
  /** When true, HITL `mode: "sensitive"` will require approval before this tool runs */
  sensitive?: boolean;
  timeout?: number;
  /**
   * Tool-result cache config.
   * When enabled, the kernel stores the result keyed by tool name + args hash,
   * and returns the cached value on subsequent identical calls without re-executing.
   * Only applied to non-error results.
   *
   * Cache key: `eta:tool-cache:{name}:{sha256(stableArgs)}`
   */
  cache?: {
    enabled: boolean;
    /** TTL for cached results in milliseconds. Defaults to no expiry. */
    ttlMs?: number;
  };
}

export interface ToolConfig<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** Zod schema describing the tool's input parameters */
  params: T;
  handler: (args: z.infer<T>) => Promise<string>;
  sequential?: boolean;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Tool call record (persisted in run state)
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  agentName: string;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ToolContext {
  runId: string;
  agentName: string;
  /** Read-only snapshot of the current message history */
  messages: readonly Message[];
  metadata?: Record<string, unknown>;
  /** Agent's store — used for tool-result caching when `tool.cache.enabled`. */
  store?: StoreProvider;
}

export interface ToolExecResult {
  output: string;
  isError: boolean;
  durationMs: number;
}
