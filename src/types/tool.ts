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
