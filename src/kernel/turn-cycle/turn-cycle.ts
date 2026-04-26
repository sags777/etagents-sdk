import type { ModelProvider, StreamChunk, TokenUsage, FinishReason } from "../../interfaces/model.js";
import type { StoreProvider } from "../../interfaces/store.js";
import type { ToolCall, ToolResult } from "../../types/message.js";
import type { TurnCycleContext } from "../../types/kernel.js";
import type { ToolCallRecord } from "../../types/tool.js";
import type { RunState, RunEvent } from "../../types/run.js";
import type { HitlConfig, LifecycleHooks, HookContext } from "../../types/agent.js";
import type { PendingApproval } from "../../types/checkpoint.js";
import type { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { PrivacyFence } from "../privacy-fence/privacy-fence.js";
import type { BudgetLedger } from "../budget-ledger/budget-ledger.js";
import { safeHook } from "../lifecycle/lifecycle.js";
import { routeTool } from "../tool-router/tool-router.js";
import type { ToolContext } from "../../types/tool.js";
import { nanoid } from "nanoid";

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
}

function zeroUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0 };
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

  for await (const chunk of stream) {
    if (signal?.aborted) break;

    switch (chunk.type) {
      case "text":
        text += chunk.delta;
        emit?.({ kind: "text_delta", delta: chunk.delta, turn: turn ?? 0 });
        break;

      case "tool_start":
        toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: {} });
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
        break;
    }
  }

  if (text.length > 0) {
    emit?.({ kind: "text_done", text, turn: turn ?? 0 });
  }

  return { text, toolCalls, usage, finishReason };
}

function needsApproval(call: ToolCall, registry: ToolRegistry, hitl: HitlConfig): boolean {
  if (hitl.mode === "none") return false;
  if (hitl.mode === "tool") return true;
  // sensitive mode — only tools marked sensitive: true
  const def = registry.get(call.name);
  return def?.sensitive === true;
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
    await safeHook(() => Promise.resolve(ctx.hooks.onTurnStart?.(turnNumber, { agentName: ctx.agentName, runId: ctx.runId, turn: turnNumber })));
    ctx.emit({ kind: "turn_start", turn: turnNumber });

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
      })),
      {
        tools: toolDefs,
        maxTokens: ctx.maxTokens,
        signal: ctx.signal,
      },
    );

    // 4. Collect stream — emits text_delta / text_done via ctx.emit as chunks arrive
    const collected = await collectStream(stream, ctx.signal, ctx.emit, turnNumber);

    // 5. Unmask response text
    const response = await ctx.fence.unmaskText(collected.text);

    // 6. Update budget ledger
    ctx.ledger.add(collected.usage);
    ctx.ledger.checkAndEmit(ctx.maxTokens);

    // 7. onTurnEnd hook + emit
    await safeHook(() => Promise.resolve(ctx.hooks.onTurnEnd?.(turnNumber, { agentName: ctx.agentName, runId: ctx.runId, turn: turnNumber })));
    ctx.emit({ kind: "turn_end", turn: turnNumber, usage: collected.usage });

    // 8. Append assistant message
    state.messages.push({
      role: "assistant",
      content: response,
      toolCalls: collected.toolCalls.length > 0 ? collected.toolCalls : undefined,
    });
    state.turns = turnNumber;

    // 9. No tool calls or stop → done
    if (collected.toolCalls.length === 0 || collected.finishReason === "stop") {
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
      messages: state.messages,
      store: ctx.store,
    };

    const results = await dispatchToolCalls(
      collected.toolCalls,
      ctx.registry,
      ctx.hub,
      toolContext,
    );

    // 13. Fire hooks + append tool results
    for (const result of results) {
      await safeHook(() => Promise.resolve(ctx.hooks.onToolResult?.(result, { agentName: ctx.agentName, runId: ctx.runId, turn: turnNumber })));
      ctx.emit({
        kind: "tool_result",
        toolCallId: result.toolCallId,
        result: result.content,
        isError: result.isError,
        durationMs: 0,
      });
      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: result.toolCallId,
      });
    }

    // Record tool calls
    for (const call of collected.toolCalls) {
      const result = results.find((r) => r.toolCallId === call.id);
      if (result) {
        const record: ToolCallRecord = {
          id: call.id || nanoid(),
          name: call.name,
          args: call.args,
          result: result.content,
          durationMs: 0,
          agentName: ctx.agentName,
        };
        state.toolCallRecords.push(record);
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
): Promise<ToolResult[]> {
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
    parallel.map((call) => routeTool(call, registry, hub, context)),
  );

  // Run sequential calls one-at-a-time
  const serialResults: ToolResult[] = [];
  for (const call of sequential) {
    serialResults.push(await routeTool(call, registry, hub, context));
  }

  // Restore original order
  const resultMap = new Map<string, ToolResult>();
  for (const r of [...parallelResults, ...serialResults]) {
    resultMap.set(r.toolCallId, r);
  }
  return calls.map((c) => resultMap.get(c.id)!);
}
