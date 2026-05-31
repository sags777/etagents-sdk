import type {
  StreamChunk,
  TokenUsage,
  FinishReason,
} from "../../types/contracts/model.js";
import type { ToolCall } from "../../types/domain/message.js";
import type { Message } from "../../types/domain/message.js";
import type { TurnCycleContext } from "../../types/domain/kernel.js";
import type { ToolCallRecord } from "../../types/domain/tool.js";
import type { RunState, RunEvent } from "../../types/domain/run.js";
import type { HitlConfig } from "../../types/domain/agent.js";
import type { PendingApproval } from "../../types/domain/checkpoint.js";
import type { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import { safeHook } from "./safe-hook.js";
import { routeToolTimed } from "../tool-router/tool-router.js";
import type { TimedToolResult } from "../tool-router/tool-router.js";
import type { ToolContext } from "../../types/domain/tool.js";
import { nanoid } from "nanoid";
import { zeroUsage } from "../../providers/model/shared/stream.js";

// ---------------------------------------------------------------------------
// TurnResult — discriminated union returned by TurnCycle.execute()
// ---------------------------------------------------------------------------

export type TurnResult =
  | { kind: "continue" }
  | { kind: "done"; response: string }
  | { kind: "suspend"; pendingApprovals: PendingApproval[] }
  | { kind: "budget"; lastResponse: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CollectedTurn {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  errorMsg?: string;
}

async function collectStream(
  stream: AsyncIterable<StreamChunk>,
  signal?: AbortSignal,
  emit?: (event: RunEvent) => void,
  turn?: number,
): Promise<CollectedTurn> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage: TokenUsage = zeroUsage();
  let finishReason: FinishReason = "stop";
  let errorMsg: string | undefined;

  for await (const chunk of stream) {
    if (signal?.aborted) break;

    switch (chunk.type) {
      case "text":
        text += chunk.delta;
        emit?.({ kind: "text_delta", delta: chunk.delta, turn: turn ?? 0 });
        break;

      case "tool_start":
        toolCalls.push({
          id: chunk.toolCallId,
          name: chunk.toolName,
          args: {},
        });
        break;

      case "tool_end": {
        const entry = toolCalls.find((tc) => tc.id === chunk.toolCallId);
        if (entry) {
          entry.args = chunk.input;
        } else {
          // Defensive: tool_end without prior tool_start
          toolCalls.push({ id: chunk.toolCallId, name: "", args: chunk.input });
        }
        break;
      }

      case "finish":
        usage = chunk.usage;
        finishReason = chunk.finishReason;
        errorMsg = (chunk as { errorMsg?: string }).errorMsg;
        break;
    }
  }

  if (text.length > 0) {
    emit?.({ kind: "text_done", text, turn: turn ?? 0 });
  }

  return { text, toolCalls, usage, finishReason, errorMsg };
}

function needsApproval(
  call: ToolCall,
  registry: ToolRegistry,
  hitl: HitlConfig,
): boolean {
  switch (hitl.mode) {
    case "none":
      return false;
    case "tool":
      return true;
    case "sensitive":
    case "callback": {
      const def = registry.get(call.name);
      return def?.sensitive === true;
    }
  }
}

/**
 * compressStaleToolResults — replaces oversized tool result messages from
 * previous turns with a truncated version before the next model call.
 *
 * Only tool messages that appear BEFORE the last assistant message are
 * candidates — those are results from prior turns that the model has already
 * acted on. The most recent batch (after the last assistant message) is left
 * untouched so the model sees full fidelity for the turn it is reacting to.
 */
function compressStaleToolResults(
  messages: Message[],
  registry: ToolRegistry,
): void {
  // Build toolCallId → toolName map from every assistant message
  const callNameMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) callNameMap.set(tc.id, tc.name);
    }
  }

  // Find the last assistant message — tool results after it belong to the
  // current turn and must NOT be compressed.
  const lastAssistantIdx = messages.reduceRight(
    (found, msg, i) => (found === -1 && msg.role === "assistant" ? i : found),
    -1,
  );

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "tool" || i >= lastAssistantIdx || !msg.toolCallId)
      continue;
    const toolName = callNameMap.get(msg.toolCallId);
    if (!toolName) continue;
    const trunc = registry.get(toolName)?.outputTruncation;
    if (!trunc || msg.content.length <= trunc.maxChars) continue;
    msg.content =
      msg.content.slice(0, trunc.maxChars) + (trunc.suffix ?? "…[truncated]");
  }
}

// ---------------------------------------------------------------------------
// Payload builders — collapse repeated inline object literals
// ---------------------------------------------------------------------------

function buildToolCallEvent(
  call: ToolCall,
  agentName: string,
  turn: number,
): Extract<RunEvent, { kind: "tool_call" }> {
  return { kind: "tool_call", toolCall: call, agentName, turn };
}

function buildToolResultEvent(
  toolCallId: string,
  content: string,
  isError: boolean,
  isFromCache: boolean,
  durationMs: number,
  turn: number,
): Extract<RunEvent, { kind: "tool_result" }> {
  return { kind: "tool_result", toolCallId, result: content, isError, isFromCache, durationMs, turn };
}

function buildToolCallRecord(
  call: ToolCall,
  timed: TimedToolResult,
  agentName: string,
  turn: number,
): ToolCallRecord {
  return {
    id: call.id || nanoid(),
    name: call.name,
    args: call.args,
    result: timed.result.content,
    durationMs: timed.durationMs,
    agentName,
    turn,
    isError: timed.result.isError,
    isFromCache: timed.isFromCache,
  };
}

// ---------------------------------------------------------------------------
// TurnCycle
// ---------------------------------------------------------------------------

/**
 * TurnCycle — executes a single model turn and all resulting tool calls.
 *
 * Stateless: a single instance is constructed per run and `execute()` is
 * called in a loop. All state lives in the `RunState` passed in — the
 * cycle mutates it (appends messages, increments turns).
 */
export class TurnCycle {
  async execute(state: RunState, ctx: TurnCycleContext): Promise<TurnResult> {
    const turnNumber = state.turns + 1;

    // 1. onTurnStart hook
    await safeHook(() =>
      Promise.resolve(
        ctx.hooks.onTurnStart?.(turnNumber, {
          agentName: ctx.agentName,
          runId: ctx.runId,
          turn: turnNumber,
        }),
      ),
    );
    ctx.emit({ kind: "turn_start", turn: turnNumber });

    // 1b. Compress stale tool results from previous turns before sending to model.
    // The current turn’s results (after the last assistant message) are left intact.
    compressStaleToolResults(state.messages, ctx.registry);

    // 2. Mask messages before sending to model
    const maskedMessages = await ctx.fence.maskMessages(state.messages);

    // 3. Stream from model
    const toolDefs = ctx.registry.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema as Record<string, unknown>,
    }));

    const stream = ctx.model.stream(
      maskedMessages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      })),
      {
        tools: toolDefs,
        maxTokens: ctx.maxTokens,
        signal: ctx.signal,
      },
    );

    // 4. Collect stream — emits text_delta / text_done via ctx.emit as chunks arrive
    const collected = await collectStream(
      stream,
      ctx.signal,
      ctx.emit,
      turnNumber,
    );

    if (collected.finishReason === "error") {
      throw new Error(collected.errorMsg ?? "Model returned an error response");
    }

    // 5. Unmask response text
    const response = await ctx.fence.unmaskText(collected.text);

    // 6. Update budget ledger
    ctx.ledger.add(collected.usage);
    ctx.ledger.checkAndEmit(ctx.maxTokens);

    // 7. onTurnEnd hook + emit
    await safeHook(() =>
      Promise.resolve(
        ctx.hooks.onTurnEnd?.(turnNumber, {
          agentName: ctx.agentName,
          runId: ctx.runId,
          turn: turnNumber,
        }),
      ),
    );
    ctx.emit({ kind: "turn_end", turn: turnNumber, usage: collected.usage });

    // 8. Append assistant message
    state.messages.push({
      role: "assistant",
      content: response,
      toolCalls:
        collected.toolCalls.length > 0 ? collected.toolCalls : undefined,
    });
    state.turns = turnNumber;

    if (collected.toolCalls.length === 0) {
      return { kind: "done", response };
    }

    // 10. Budget check after assistant turn
    if (ctx.ledger.isExceeded(ctx.maxTokens)) {
      return { kind: "budget", lastResponse: response };
    }

    // 11. HITL check — find calls needing approval
    const pendingApprovals: PendingApproval[] = collected.toolCalls
      .filter((c) => needsApproval(c, ctx.registry, ctx.hitl))
      .map((c) => ({
        toolCallId: c.id,
        name: c.name,
        args: c.args,
        agentName: ctx.agentName,
      }));

    if (pendingApprovals.length > 0) {
      return { kind: "suspend", pendingApprovals };
    }

    // 12. Dispatch tool calls
    const toolContext: ToolContext = {
      runId: ctx.runId,
      agentName: ctx.agentName,
      agentId: ctx.agentId,
      messages: state.messages,
      store: ctx.store,
      metadata: ctx.metadata,
    };

    // Emit tool_call (→ tool.invoke) for each call before dispatch so clients
    // see the intent immediately even if execution takes seconds.
    for (const call of collected.toolCalls) {
      ctx.emit(buildToolCallEvent(call, ctx.agentName, turnNumber));
    }

    const timedResults = await dispatchToolCalls(
      collected.toolCalls,
      ctx.registry,
      ctx.hub,
      toolContext,
    );

    // 13. Fire hooks + append tool results
    for (const { result, durationMs, isFromCache } of timedResults) {
      await safeHook(() =>
        Promise.resolve(
          ctx.hooks.onToolResult?.(result, {
            agentName: ctx.agentName,
            runId: ctx.runId,
            turn: turnNumber,
          }),
        ),
      );
      ctx.emit(
        buildToolResultEvent(
          result.toolCallId,
          result.content,
          result.isError,
          isFromCache,
          durationMs,
          turnNumber,
        ),
      );
      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: result.toolCallId,
      });
    }

    // Record tool calls
    for (const call of collected.toolCalls) {
      const timed = timedResults.find((r) => r.result.toolCallId === call.id);
      if (timed) {
        state.toolCallRecords.push(
          buildToolCallRecord(call, timed, ctx.agentName, turnNumber),
        );
      }
    }

    return { kind: "continue" };
  }
}

// ---------------------------------------------------------------------------
// Tool dispatch — parallel for non-sequential, serial for sequential
// ---------------------------------------------------------------------------

async function dispatchToolCalls(
  calls: ToolCall[],
  registry: ToolRegistry,
  hub: McpHub,
  context: ToolContext,
): Promise<TimedToolResult[]> {
  const sequential: ToolCall[] = [];
  const parallel: ToolCall[] = [];

  for (const call of calls) {
    const def = registry.get(call.name);
    if (def?.sequential) {
      sequential.push(call);
    } else {
      parallel.push(call);
    }
  }

  // Run parallel calls concurrently
  const parallelResults = await Promise.all(
    parallel.map((call) => routeToolTimed(call, registry, hub, context)),
  );

  // Run sequential calls one-at-a-time
  const serialResults: TimedToolResult[] = [];
  for (const call of sequential) {
    serialResults.push(await routeToolTimed(call, registry, hub, context));
  }

  // Restore original order
  const resultMap = new Map<string, TimedToolResult>();
  for (const r of [...parallelResults, ...serialResults]) {
    resultMap.set(r.result.toolCallId, r);
  }
  return calls.map((c) => resultMap.get(c.id)!);
}
