import type { ToolDef, ToolContext, ToolExecResult } from "../../types/tool.js";
import { DEFAULT_CONFIG } from "../../config.js";

// ---------------------------------------------------------------------------
// executeTool
// ---------------------------------------------------------------------------

/**
 * executeTool — runs a tool handler with a timeout boundary.
 *
 * Contract:
 *   - Never throws. All errors (validation, handler throws, timeout) are
 *     captured and returned as `{ isError: true, output: errorMessage }`.
 *   - Arg validation is baked into handlers produced by `defineTool`. Raw
 *     args from other sources are passed through without extra validation.
 *   - Timeout is resolved from `def.timeout`, falling back to
 *     `DEFAULT_CONFIG.toolTimeoutMs`.
 */
export async function executeTool(
  def: ToolDef,
  args: unknown,
  context: ToolContext,
): Promise<ToolExecResult> {
  const startMs = Date.now();
  const timeoutMs = def.timeout ?? DEFAULT_CONFIG.toolTimeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(new Error(`Tool "${def.name}" timed out after ${timeoutMs}ms`));
    });
  });

  try {
    const output = await Promise.race([
      def.handler(args as Record<string, unknown>, context),
      timeoutPromise,
    ]);
    return { output, isError: false, durationMs: Date.now() - startMs };
  } catch (err) {
    return {
      output: err instanceof Error ? err.message : String(err),
      isError: true,
      durationMs: Date.now() - startMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
