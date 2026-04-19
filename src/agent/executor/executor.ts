import type { ToolDef } from "../../types/tool.js";
import type { Message } from "../../types/message.js";
import { DEFAULT_CONFIG } from "../../config.js";

// ---------------------------------------------------------------------------
// ToolContext — ambient info injected by the kernel on every call
// ---------------------------------------------------------------------------

export interface ToolContext {
  runId: string;
  agentName: string;
  /** Read-only snapshot of the current message history */
  messages: readonly Message[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ToolExecResult
// ---------------------------------------------------------------------------

export interface ToolExecResult {
  output: string;
  isError: boolean;
  durationMs: number;
}

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
  _context: ToolContext,
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
      def.handler(args as Record<string, unknown>),
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
