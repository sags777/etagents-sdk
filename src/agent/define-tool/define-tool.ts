import { z } from "zod";
import type { ToolConfig, ToolDef, JsonSchema } from "../../types/tool.js";
import { ToolError } from "../../errors.js";

// ---------------------------------------------------------------------------
// Internal Zod → JsonSchema converter
// ---------------------------------------------------------------------------

/**
 * zodToJsonSchema — converts a Zod v4 schema to a JSON Schema Draft 7 object.
 *
 * Delegates to Zod's built-in `toJSONSchema()` and strips the Draft 2020-12
 * `$schema` annotation so callers receive a plain, provider-compatible schema.
 */
function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  // toJSONSchema() is available on all Zod v4 types
  const raw = (schema as z.ZodType & { toJSONSchema(): Record<string, unknown> }).toJSONSchema();
  const { $schema: _drop, ...rest } = raw;
  return rest as JsonSchema;
}

// ---------------------------------------------------------------------------
// defineTool
// ---------------------------------------------------------------------------

/**
 * defineTool — creates a typed `ToolDef` from a Zod-parametrised config.
 *
 * The returned handler validates incoming args through the Zod schema before
 * forwarding them to the user's handler, so runtime arg errors surface as
 * `ToolError` rather than obscure type coercion bugs.
 */
export function defineTool<T extends z.ZodType>(config: ToolConfig<T>): ToolDef {
  const { name, description, params, handler, sequential, timeoutMs } = config;

  const schema = zodToJsonSchema(params);

  const wrappedHandler = async (rawArgs: Record<string, unknown>): Promise<string> => {
    const result = params.safeParse(rawArgs);
    if (!result.success) {
      throw new ToolError(
        `Invalid arguments for tool "${name}": ${result.error.message}`,
      );
    }
    return handler(result.data as z.infer<T>);
  };

  return {
    name,
    description,
    schema,
    handler: wrappedHandler,
    sequential,
    timeout: timeoutMs,
  };
}
