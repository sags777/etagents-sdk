<div align="center">

# @etagents/sdk

**A TypeScript SDK for building production-ready AI agents with support for multiple LLM providers, tool use, memory, and multi-agent workflows.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![ESM](https://img.shields.io/badge/Module-ESM-F7DF1E?logo=javascript&logoColor=black)](https://nodejs.org/api/esm.html)
[![Zod](https://img.shields.io/badge/Validation-Zod-3E67B1)](https://zod.dev)

[Installation](#installation) · [Quick Start](#quick-start) · [Core Concepts](#core-concepts) · [Provider Slots](#provider-slots) · [Tools](#tools) · [Runs](#runs) · [HITL](#human-in-the-loop-hitl) · [Memory](#memory) · [Privacy](#privacy) · [MCP](#mcp) · [Multi-Agent](#multi-agent) · [HTTP / SSE](#http--sse) · [Scanner](#scanner) · [CLI](#cli) · [API Reference](#api-reference) · [Architecture](#architecture)

</div>

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [createAgent](#createagent)
  - [defineTool](#definetool)
  - [startRun](#startrun)
- [Provider Slots](#provider-slots)
  - [Model](#model-provider)
  - [Memory](#memory-provider)
  - [Store](#store-provider)
  - [Privacy](#privacy-provider)
- [Tools](#tools)
  - [Zod-typed parameters](#zod-typed-parameters)
  - [Parallel vs sequential](#parallel-vs-sequential)
  - [Tool timeout](#tool-timeout)
  - [Sensitive tools (HITL)](#sensitive-tools-hitl)
  - [Standalone execution](#standalone-execution)
- [Runs](#runs)
  - [RunConfig options](#runconfig-options)
  - [RunResult shape](#runresult-shape)
  - [RunEvent stream](#runevent-stream)
  - [Lifecycle hooks](#lifecycle-hooks)
  - [Budget enforcement](#budget-enforcement)
  - [Cancellation](#cancellation)
- [Persistence](#persistence)
- [Human-in-the-Loop (HITL)](#human-in-the-loop-hitl)
  - [Modes: none / tool / sensitive](#modes-none--tool--sensitive)
  - [Suspend and resume](#suspend-and-resume)
- [Memory](#memory)
- [Privacy](#privacy)
  - [Built-in PII rules](#built-in-pii-rules)
  - [Standalone masking](#standalone-masking)
- [Insight (post-run reflection)](#insight-post-run-reflection)
- [MCP](#mcp)
  - [Connecting servers](#connecting-servers)
  - [Building a server](#building-a-server)
- [Multi-Agent](#multi-agent)
  - [AgentRouter + RuleRouter](#agentrouter--ruleRouter)
  - [AgentRouter + TriageRouter](#agentrouter--triagerouter)
- [HTTP / SSE](#http--sse)
  - [SessionEventStream](#sessioneventstream)
  - [Next.js](#nextjs)
  - [Express](#express)
  - [SessionEventSource (client)](#sessioneventsource-client)
- [Scanner](#scanner)
- [CLI](#cli)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Architecture](#architecture)
- [Contributing](#contributing)

---

## Installation

```bash
npm install @etagents/sdk
```

Requires **Node.js ≥ 18** and **TypeScript ≥ 5.6** (ESM only).

---

## Quick Start

```typescript
// examples/01-basic-run.ts
// ──────────────────────────────────────────────────────────────────────────
// Minimal example: create an agent, run it once, print the result.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/01-basic-run.ts
// ──────────────────────────────────────────────────────────────────────────

import { createAgent, startRun } from "@etagents/sdk";

const agent = createAgent({
  name: "assistant",
  systemPrompt: "You are a concise, helpful assistant.",
  model: "claude-sonnet-4-6",
});

const result = await startRun(agent, "What is the capital of France?");

console.log(result.response); // "The capital of France is Paris."
console.log(result.status);   // "complete"
console.log(result.turns);    // 1
```

---

## Core Concepts

### createAgent

`createAgent(config: AgentConfig): AgentDef` validates your configuration, resolves string model shorthands to a `ModelProvider`, fills missing provider slots with defaults, and returns a frozen `AgentDef` handle. Pass the `AgentDef` to `startRun` — never construct it directly.

```typescript
import { createAgent, AnthropicModel, FileStore, RegexPrivacy } from "@etagents/sdk";

const agent = createAgent({
  name: "my-agent",
  systemPrompt: "You are a helpful assistant.",

  // Model: string shorthand or full ModelProvider instance
  model: "claude-sonnet-4-6",
  // model: AnthropicModel.create({ apiKey: "...", model: "claude-opus-4-6" }),

  // Optional — defaults shown
  tools: [],
  maxTurns: 20,
  maxTokens: 8192,
});
```

**`AgentConfig` fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | required | Agent identifier |
| `systemPrompt` | `string` | required | Base system prompt |
| `model` | `ModelProvider \| string` | `"claude-sonnet-4-6"` | LLM backend |
| `memory` | `MemoryProvider` | no memory | Semantic retrieval |
| `store` | `StoreProvider` | `FileStore` | Session persistence |
| `privacy` | `PrivacyProvider` | no masking | PII gate |
| `tools` | `ToolDef[]` | `[]` | Callable tools |
| `mcp` | `McpServerConfig[]` | `[]` | MCP servers to connect |
| `insight` | `InsightConfig` | disabled | Post-run fact extraction |
| `hitl` | `HitlConfig` | `{ mode: "none" }` | Human-in-the-loop |
| `hooks` | `LifecycleHooks` | no-op hooks | Turn/tool lifecycle callbacks |
| `maxTurns` | `number` | `20` | Hard turn cap |
| `maxTokens` | `number` | `8192` | Token budget per run |

### defineTool

`defineTool` wraps a Zod schema and a handler into a `ToolDef`. The kernel validates incoming arguments through the Zod schema before calling your handler — runtime argument mismatches surface as `ToolError` rather than silent type coercion.

```typescript
import { z } from "zod";
import { defineTool } from "@etagents/sdk";

const searchDatabase = defineTool({
  name: "search_database",
  description: "Searches the database for records matching the query",
  params: z.object({
    query: z.string().describe("Search query"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results"),
  }),
  handler: async ({ query, limit = 10 }) => {
    // handler always receives fully typed, validated arguments
    const rows = await db.search(query, limit);
    return JSON.stringify(rows);
  },
});
```

**`ToolConfig` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique tool name (no spaces) |
| `description` | `string` | Shown to the LLM to aid selection |
| `params` | `ZodType` | Zod schema for input validation |
| `handler` | `(args) => Promise<string>` | Async implementation — must return a string |
| `sequential` | `boolean?` | If `true`, never runs concurrently with other tool calls |
| `timeoutMs` | `number?` | Per-tool timeout; overrides session `toolTimeoutMs` |

### startRun

`startRun(agent, input, config?)` runs the agent to completion and returns a `RunResult`. The kernel loop continues until the LLM produces a final response with no tool calls, the turn cap is hit, the token budget is exceeded, a HITL suspension triggers, or an abort signal fires.

```typescript
import { startRun } from "@etagents/sdk";

const result = await startRun(agent, "Summarise the sales data for Q4", {
  maxTurns: 15,
  onEvent: (event) => {
    if (event.kind === "tool_call") console.log(`Calling ${event.toolCall.name}`);
  },
});

console.log(result.response);    // Final LLM response
console.log(result.status);      // "complete" | "error" | "cancelled" | "budget_exceeded" | "awaiting_approval"
console.log(result.turns);       // Number of LLM turns taken
console.log(result.toolCalls);   // Every tool call with name, args, result, durationMs
console.log(result.totalUsage);  // { prompt, completion, total } token counts
```

---

## Provider Slots

Four slots in `AgentConfig` are swappable. Everything else is kernel-internal and not replaceable.

| Slot | Interface | Default | Swap use case |
|------|-----------|---------|---------------|
| `model` | `ModelProvider` | `AnthropicModel` (`claude-sonnet-4-6`) | Anthropic → OpenAI → local Ollama → custom |
| `memory` | `MemoryProvider` | no-op (no memory) | Our Redis → SuperMemory → MemPalace → custom |
| `store` | `StoreProvider` | `FileStore` | File → Redis → Postgres → custom |
| `privacy` | `PrivacyProvider` | no-op (no masking) | Regex → NER model → enterprise PII engine |

### Model Provider

Ship with four production providers and one deterministic test double.

```typescript
import { AnthropicModel, OpenAIModel, AzureModel, GeminiModel, MockModel } from "@etagents/sdk";

// Anthropic (default when you pass a string shorthand)
const anthropic = AnthropicModel.create({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-opus-4-6",
});

// OpenAI
const openai = OpenAIModel.create({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",
});

// Azure OpenAI
const azure = AzureModel.create({
  apiKey: process.env.AZURE_API_KEY!,
  baseUrl: "https://my-resource.openai.azure.com/openai/deployments/gpt-4o",
  model: "gpt-4o",
});

// Google Gemini
const gemini = GeminiModel.create({
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.0-flash",
});

// MockModel — deterministic responses for tests, no API calls
const mock = new MockModel([
  {
    text: null,
    toolCalls: [{ id: "call_1", name: "search_database", args: { query: "Q4 sales" } }],
    usage: { prompt: 50, completion: 20, total: 70 },
  },
  {
    text: "Q4 sales totalled $2.4M across three regions.",
    toolCalls: [],
    usage: { prompt: 80, completion: 30, total: 110 },
  },
]);
```

String shorthands for `model` in `AgentConfig` resolve to `AnthropicModel.create({ apiKey: process.env.ANTHROPIC_API_KEY, model: "<shorthand>" })`.

### Memory Provider

Self-contained retrieval. Implementations handle their own embeddings — the kernel never calls an embedder directly.

```typescript
import { InMemory, RedisMemory } from "@etagents/sdk";

// InMemory — cosine similarity over plain array; no infrastructure required
// Best for local dev, unit tests, and low-volume deployments
const mem = new InMemory();

// RedisMemory — Redis Stack (with RediSearch) + OpenAI embeddings
// For cross-session recall in production
const mem = new RedisMemory({
  redis: redisClient,
  embedder: openAIEmbedder,
  indexName: "eta:memory",        // default
  ttlSeconds: 604_800,            // 7 days
  minScore: 0.7,                  // matches DEFAULT_CONFIG.memoryMinScore
});
```

### Store Provider

Key-value persistence for session snapshots and HITL checkpoints.

```typescript
import { FileStore, RedisStore } from "@etagents/sdk";

// FileStore — JSON files in a directory; default when no store is configured
const store = new FileStore({ dir: ".sessions" });

// RedisStore — distributed; use in multi-instance deployments
const store = new RedisStore({
  url: process.env.REDIS_URL,
  keyPrefix: "eta:",              // optional
});
```

### Privacy Provider

PII masking applied before every LLM call. The `PrivacyFence` in the kernel accumulates the replacement map across turns — tool handlers always receive the original unmasked values.

```typescript
import { RegexPrivacy, BUILTIN_RULES } from "@etagents/sdk";

const privacy = new RegexPrivacy({
  rules: [
    BUILTIN_RULES.email,        // bob@acme.com  → ⟨eta:email:0001⟩
    BUILTIN_RULES.phone,        // (555) 123-4567 → ⟨eta:phone:0001⟩
    BUILTIN_RULES.ssn,          // 123-45-6789 → ⟨eta:ssn:0001⟩
    BUILTIN_RULES.creditCard,   // 4111-1111-1111-1111 → ⟨eta:cc:0001⟩
    BUILTIN_RULES.ipv4,         // 192.168.1.1 → ⟨eta:ip:0001⟩
  ],
  customRules: [
    { pattern: /ACCT-\d{8}/g, label: "account" },
  ],
});
```

Placeholder format: `⟨eta:<label>:<4-hex-id>⟩` — unambiguously distinct from any user-generated text.

---

## Tools

### Zod-typed Parameters

`defineTool` converts the Zod schema to JSON Schema and exposes it to the LLM. Full Zod constraint support: `.min()`, `.max()`, `.regex()`, `.email()`, `.url()`, `z.enum()`, `z.union()`, `z.literal()`, `z.record()`.

```typescript
const createUser = defineTool({
  name: "create_user",
  description: "Creates a new user account",
  params: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
    metadata: z.record(z.string()).optional(),
  }),
  handler: async ({ name, email, role, metadata }) => {
    const user = await db.users.create({ name, email, role, metadata });
    return JSON.stringify({ id: user.id, name: user.name });
  },
});
```

### Parallel vs Sequential

All tool calls in a single LLM turn run **concurrently** by default via `Promise.all`. Mark a tool `sequential: true` to force single-at-a-time execution.

```typescript
// These two run in parallel when the LLM requests both simultaneously
const fetchWeather = defineTool({ name: "fetch_weather", ... });
const fetchStocks = defineTool({ name: "fetch_stocks", ... });

// This always runs alone — database writes should not interleave
const writeRecord = defineTool({
  name: "write_record",
  sequential: true,
  ...
});
```

The kernel partitions tool calls into a parallel batch and a sequential queue per turn. Parallel tools execute first (via `Promise.all`), sequential tools run after in order.

### Tool Timeout

```typescript
const callExternalApi = defineTool({
  name: "call_external_api",
  timeoutMs: 5_000,   // 5 s — overrides session toolTimeoutMs for this tool
  ...
});

// Session-wide default
const result = await startRun(agent, input, { /* toolTimeoutMs set in AgentConfig */ });
```

`DEFAULT_CONFIG.toolTimeoutMs` is `30_000` ms. Timed-out tools receive a `ToolError` and the LLM sees the error message in the tool result.

### Sensitive Tools (HITL)

Mark tools `sensitive: true` and set `hitl.mode: "sensitive"` on the agent to require human approval before they execute.

```typescript
const sendEmail = defineTool({
  name: "send_email",
  description: "Sends an email on behalf of the user",
  params: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  handler: async ({ to, subject, body }) => { /* ... */ },
  // sensitive flag read by the kernel's HITL check
});
```

See [Human-in-the-Loop (HITL)](#human-in-the-loop-hitl) for the full suspend/resume flow.

### Standalone Execution

Execute a tool directly, bypassing the LLM loop:

```typescript
import { executeTool } from "@etagents/sdk";

const result = await executeTool(searchDatabase, { query: "hello", limit: 5 });

if (result.ok) {
  console.log(result.data); // validated, typed result
} else {
  console.error(result.error); // ToolError with message
}
```

---

## Runs

### RunConfig Options

```typescript
import { startRun } from "@etagents/sdk";

const result = await startRun(agent, "Analyse Q4 sales", {
  // Turn and budget limits (override AgentConfig defaults)
  maxTurns: 15,
  maxTokens: 16_000,

  // Session identity — used for persistence and resumption
  runId: "session-user-123",

  // Arbitrary metadata attached to the persisted SessionSnapshot
  metadata: { userId: "u_abc", tier: "pro" },

  // Cancellation
  signal: abortController.signal,

  // Real-time event stream
  onEvent: (event) => console.log(event.kind, event),

  // HITL override — same shape as AgentConfig.hitl
  hitl: { mode: "sensitive" },

  // Budget config — granular BudgetLedger knobs
  budget: {
    warnAtPercent: 80,  // emits a BudgetEvent before the hard stop
  },
});
```

### RunResult Shape

| Field | Type | Description |
|-------|------|-------------|
| `response` | `string` | Final LLM message |
| `messages` | `Message[]` | Full conversation history |
| `toolCalls` | `ToolCallRecord[]` | All tool invocations with args, result, durationMs |
| `turns` | `number` | LLM turns consumed |
| `status` | `RunStatus` | `"complete"` · `"error"` · `"cancelled"` · `"budget_exceeded"` · `"awaiting_approval"` |
| `totalUsage` | `TokenUsage?` | `{ prompt, completion, total }` across all turns |

### RunEvent Stream

Subscribe to real-time events via `onEvent`. Events are discriminated on `kind`:

```typescript
const result = await startRun(agent, input, {
  onEvent: (event) => {
    switch (event.kind) {
      case "turn_start":
        console.log(`Turn ${event.turn} starting`);
        break;
      case "turn_end":
        console.log(`Turn ${event.turn} used`, event.usage.total, "tokens");
        break;
      case "tool_call":
        console.log(`→ ${event.toolCall.name}`, event.toolCall.args);
        break;
      case "tool_result":
        console.log(`← ${event.toolCallId}`, event.result, `(${event.durationMs}ms)`);
        break;
      case "error":
        console.error(event.code, event.message);
        break;
      case "complete":
        console.log("Done:", event.result.status);
        break;
    }
  },
});
```

| Event kind | Fields | When |
|-----------|--------|------|
| `turn_start` | `turn` | Before each LLM call |
| `turn_end` | `turn`, `usage` | After each LLM response |
| `tool_call` | `toolCall`, `agentName` | Before each tool execution |
| `tool_result` | `toolCallId`, `result`, `isError`, `durationMs` | After each tool returns |
| `error` | `message`, `code` | On any non-fatal error |
| `complete` | `result` | When the run exits |

### Lifecycle Hooks

Four insertion points that can observe or transform run data. All hooks are **fail-open** — errors are swallowed via `safeHook()` and never crash the session.

```typescript
const agent = createAgent({
  name: "my-agent",
  systemPrompt: "...",
  hooks: {
    onTurnStart: async (turn) => {
      console.log(`Turn ${turn} beginning`);
    },
    onTurnEnd: async (turn) => {
      console.log(`Turn ${turn} complete`);
    },
    onToolCall: async (call) => {
      await telemetry.record("tool_call", { tool: call.name, args: call.args });
    },
    onToolResult: async (result) => {
      await telemetry.record("tool_result", { id: result.toolCallId, error: result.isError });
    },
    beforeComplete: async (messages) => {
      // Final chance to inspect the full conversation before the run exits
      await audit.log(messages);
    },
  },
});
```

| Hook | Signature | Purpose |
|------|-----------|---------|
| `onTurnStart` | `(turn: number) => void` | Before each LLM call |
| `onTurnEnd` | `(turn: number) => void` | After each LLM response |
| `onToolCall` | `(call: ToolCall) => void` | Before each tool executes |
| `onToolResult` | `(result: ToolResult) => void` | After each tool returns |
| `beforeComplete` | `(messages: Message[]) => void` | Just before the run returns |

### Budget Enforcement

Set `maxTokens` in `AgentConfig` or `RunConfig`. The `BudgetLedger` accumulates `prompt + completion` token counts after each turn. When the total crosses `maxTokens`, the run exits with `status: "budget_exceeded"`.

```typescript
const result = await startRun(agent, "Analyse this large dataset", {
  maxTokens: 20_000,
  budget: { warnAtPercent: 80 },   // emits a BudgetEvent at 16 000 tokens
});

if (result.status === "budget_exceeded") {
  console.log("Budget hit at turn", result.turns);
  console.log("Usage:", result.totalUsage);
}
```

### Cancellation

Pass an `AbortSignal` to cancel mid-flight:

```typescript
const controller = new AbortController();

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10_000);

const result = await startRun(agent, "Long-running task", {
  signal: controller.signal,
});

if (result.status === "cancelled") {
  console.log("Run was cancelled");
}
```

The signal is checked before every LLM turn and threaded through to the model's `stream()` call so the HTTP connection closes immediately.

---

## Persistence

Attach a store and set a `runId` to automatically persist and resume sessions.

```typescript
import { FileStore, RedisStore } from "@etagents/sdk";

// ── First run ──
const agent = createAgent({
  name: "assistant",
  systemPrompt: "You are a helpful assistant.",
  store: new FileStore({ dir: ".sessions" }),
});

await startRun(agent, "My name is Sagar.", { runId: "user-sagar" });

// ── Later run — full history is hydrated automatically ──
await startRun(agent, "What is my name?", { runId: "user-sagar" });
// → "Your name is Sagar."
```

**Session snapshot format:**

```typescript
interface SessionSnapshot {
  version: 1;
  runId: string;
  messages: Message[];
  metadata: Record<string, unknown>;
  createdAt: string;   // ISO-8601
  updatedAt: string;
  __eta: {};           // Reserved for kernel use
}
```

The kernel persists a snapshot after every run (best-effort — persistence failures never crash a run). `continueRun` loads the snapshot, re-hydrates the message history, and executes the tool decisions before resuming the turn loop.

---

## Human-in-the-Loop (HITL)

### Modes: none / tool / sensitive

```typescript
const agent = createAgent({
  name: "assistant",
  systemPrompt: "...",
  hitl: {
    mode: "sensitive",          // Require approval only for tools marked sensitive
    timeoutMs: 120_000,         // 2-minute window before auto-expiry
    hitlStore: new RedisStore({ url: process.env.REDIS_URL }),
  },
});
```

| Mode | Behaviour |
|------|-----------|
| `"none"` | No approval required (default) |
| `"tool"` | Every tool call requires approval |
| `"sensitive"` | Only tools with `sensitive: true` in their `ToolDef` require approval |

### Suspend and Resume

When the kernel reaches a tool call requiring approval, it serialises the full run state to the HITL store as a `SuspendSnapshot` and returns with `status: "awaiting_approval"`. Call `continueRun` with approval decisions when the human has responded.

```typescript
import { startRun, continueRun } from "@etagents/sdk";

// ── Step 1: Run suspends when it hits a sensitive tool ──
const result = await startRun(agent, "Send an email to alice@example.com", {
  runId: "session-alice",
});

// result.status === "awaiting_approval"
// pendingApprovals holds the serialised tool calls
const { pendingApprovals } = result;

// ── Step 2: Show approvals to the user (your UI / webhook) ──
console.log(pendingApprovals);
// [{ toolCallId: "tc_abc", name: "send_email", args: { to: "alice@example.com", ... }, agentName: "assistant" }]

// ── Step 3: Resume with decisions ──
const resumed = await continueRun(
  checkpointId,        // returned from the store as part of suspend metadata
  [
    { toolCallId: "tc_abc", approved: true },   // approve
    { toolCallId: "tc_xyz", approved: false },  // deny — LLM receives rejection message
  ],
  { agent },
);

console.log(resumed.status);    // "complete"
console.log(resumed.response);  // LLM's final message incorporating tool results
```

**`ApprovalDecision` shape:**

```typescript
interface ApprovalDecision {
  toolCallId: string;
  approved: boolean;
}
```

Denied tool calls receive a synthetic `"Tool call rejected by human reviewer."` result message that the LLM can incorporate into its final response.

---

## Memory

The `MemoryProvider` slot adds cross-run semantic recall. Before the first turn, the kernel retrieves relevant memories via `MemoryPipe.retrieve(input)` and appends them to the system prompt as a `Relevant context:` block. After the run, `MemoryPipe.index([])` fires (fire-and-forget — never awaited on the critical path).

```typescript
import { createAgent, startRun, InMemory } from "@etagents/sdk";

const agent = createAgent({
  name: "assistant",
  systemPrompt: "You are a helpful assistant with long-term memory.",
  memory: new InMemory(),
});

// First run — agent notes user preference
await startRun(agent, "I prefer dark mode and Vim keybindings.", { runId: "u_1" });

// Later run — memories are retrieved and injected
const result = await startRun(agent, "What are my editor preferences?", { runId: "u_1" });
// → "You prefer dark mode and Vim keybindings."
```

For production use with Redis Stack:

```typescript
import { RedisMemory } from "@etagents/sdk";

// RedisMemory requires Redis Stack (includes RediSearch for vector search)
// Do NOT use plain Redis — `FT.CREATE` / `FT.SEARCH` commands will fail
const memory = new RedisMemory({
  redis: createClient({ url: process.env.REDIS_URL }),
  embedder: openAIEmbedder,
  minScore: 0.7,         // Only inject memories above this similarity threshold
  ttlSeconds: 604_800,   // Expire entries after 7 days
});
```

`MemoryProvider` contract: `index()` must never throw (swallow errors — a failed index must not fail the session). `search()` scores must be normalised 0–1 regardless of the underlying metric.

---

## Privacy

The `PrivacyFence` in the kernel applies PII masking before every LLM call and unmasks the model's response after. Tool handlers always receive the original unmasked values.

```typescript
import { createAgent, startRun, RegexPrivacy, BUILTIN_RULES } from "@etagents/sdk";

const agent = createAgent({
  name: "assistant",
  systemPrompt: "Process customer requests.",
  privacy: new RegexPrivacy({
    rules: [BUILTIN_RULES.email, BUILTIN_RULES.phone, BUILTIN_RULES.ssn],
    customRules: [{ pattern: /ACCT-\d{8}/g, label: "account" }],
  }),
});

// The LLM never sees "bob@acme.com" — it sees "⟨eta:email:0001⟩"
const result = await startRun(agent, "Email bob@acme.com about account ACCT-12345678");
// The response is automatically unmasked before it is returned in RunResult
```

### Built-in PII Rules

| Constant | Matches |
|----------|---------|
| `BUILTIN_RULES.email` | RFC 5321 email addresses |
| `BUILTIN_RULES.phone` | US and international phone numbers |
| `BUILTIN_RULES.ssn` | US Social Security Numbers |
| `BUILTIN_RULES.creditCard` | Major credit card formats |
| `BUILTIN_RULES.ipv4` | IPv4 addresses |

### Standalone Masking

```typescript
import { RegexPrivacy, BUILTIN_RULES } from "@etagents/sdk";

const privacy = new RegexPrivacy({ rules: [BUILTIN_RULES.email] });

const { masked, map } = await privacy.mask("Contact bob@acme.com");
// masked: "Contact ⟨eta:email:0001⟩"
// map: Map { "⟨eta:email:0001⟩" => "bob@acme.com" }

const original = await privacy.unmask(masked, map);
// "Contact bob@acme.com"
```

---

## Insight (post-run reflection)

`insight` drives automatic post-run fact extraction. The kernel calls `runInsight()` after the turn loop exits (if enabled) and returns a structured `InsightResult`. Results are stored in `SessionSnapshot.__eta` for injection into future sessions.

```typescript
const agent = createAgent({
  name: "assistant",
  systemPrompt: "You are a helpful assistant.",
  insight: {
    enabled: true,
    model: "claude-haiku-4-5",   // Use a cheaper model for reflection
    maxFacts: 30,                // Cap on extractable facts (default from config)
    prompts: {
      extractFacts: "Extract key decisions, user preferences, and action items only.",
    },
  },
});
```

**`InsightResult` shape:**

```typescript
interface InsightResult {
  facts: string[];      // Session decisions, preferences, context (evictable, cap: maxFacts)
  userFacts: string[];  // Identity facts (name, role, title — never evicted, cap: 10)
  summary: string;      // One-paragraph session summary
  topics: string[];     // High-level topic tags
}
```

Deduplication is three-tier:
1. **Exact normalised match** — lowercased, trimmed, whitespace-collapsed
2. **Levenshtein near-duplicate** — similarity ≥ 0.85 threshold
3. **Cap** — later (task-outcome) facts are at the end of the pool and are evicted first

---

## MCP

### Connecting Servers

Pass `mcp` configs to `createAgent`. `McpHub` connects all servers before the first turn and disconnects in `finally`.

```typescript
import { createAgent, McpClient } from "@etagents/sdk";

const agent = createAgent({
  name: "assistant",
  systemPrompt: "You are a helpful assistant.",
  mcp: [
    {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      serverName: "filesystem",
    },
    {
      transport: "sse",
      url: "http://localhost:3001/sse",
      serverName: "custom-server",
    },
  ],
});
```

MCP tools are namespaced as `mcp::<serverName>::<toolName>` to prevent collisions with local tools.

### Building a Server

```typescript
import { McpServer } from "@etagents/sdk";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

server.addTool({
  name: "get_time",
  description: "Returns the current UTC time",
  parameters: z.object({}),
  handler: async () => new Date().toISOString(),
});

server.addTool({
  name: "search",
  description: "Search the knowledge base",
  parameters: z.object({ query: z.string(), topK: z.number().default(5) }),
  handler: async ({ query, topK }) => {
    const results = await kb.search(query, topK);
    return JSON.stringify(results);
  },
});

// Start on stdio transport (default)
server.start();
```

---

## Multi-Agent

### AgentRouter + RuleRouter

`AgentRouter` holds a pool of `AgentDef`s and delegates each message to the agent selected by the configured `RoutingStrategy`. `RuleRouter` is a zero-LLM deterministic strategy.

```typescript
import { AgentRouter, RuleRouter } from "@etagents/sdk";

const supportAgent = createAgent({ name: "support", systemPrompt: "You handle customer support issues.", ... });
const billingAgent = createAgent({ name: "billing", systemPrompt: "You handle invoices and payments.", ... });
const generalAgent = createAgent({ name: "general", systemPrompt: "You are a general-purpose assistant.", ... });

const strategy = new RuleRouter()
  .when(/\b(bug|error|crash|broken)\b/i, supportAgent)
  .when(/\b(invoice|payment|billing|charge)\b/i, billingAgent)
  .fallback(generalAgent)
  .build();

const router = AgentRouter.create()
  .add(supportAgent)
  .add(billingAgent)
  .add(generalAgent)
  .withStrategy(strategy)
  .build();

// Route a message to the best-matched agent
const result = await router.run("I was double-charged on my last invoice");
// Routes to billingAgent (billing pattern matches first)
```

**`RuleRouter` behaviour:**
- Rules evaluated in insertion order — first match wins with `confidence: 1`
- Fallback agent used when no rule matches (`confidence: 0.5`)
- Throws when no rule matches and no fallback is set
- String patterns are converted to case-insensitive fixed-string regexes

### AgentRouter + TriageRouter

`TriageRouter` makes a single LLM call to select the best agent. Use a fast/cheap model for the routing decision.

```typescript
import { AgentRouter, TriageRouter, AnthropicModel } from "@etagents/sdk";

const triageModel = AnthropicModel.create({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-haiku-4-5",   // cheap model for routing only
});

const strategy = new TriageRouter({
  model: triageModel,
  agents: [supportAgent, billingAgent, generalAgent],
});

const router = AgentRouter.create()
  .add(supportAgent)
  .add(billingAgent)
  .add(generalAgent)
  .withStrategy(strategy)
  .build();

const result = await router.run("Can I get a refund on my subscription?");
```

**`RoutingDecision` shape:**

```typescript
interface RoutingDecision {
  agentDef: AgentDef;
  confidence: number;   // 0–1; deterministic strategies always emit 1
  reason: string;       // Human-readable explanation of the routing choice
}
```

---

## HTTP / SSE

### SessionEventStream

`SessionEventStream` wraps `startRun()` / `continueRun()` into a `ReadableStream<Uint8Array>` of SSE-formatted messages. Use it in any HTTP handler that supports streaming responses.

```typescript
import { SessionEventStream, SSE_HEADERS } from "@etagents/sdk";

const eventStream = new SessionEventStream(agent);

// New run
const body = eventStream.stream("Summarise the latest sales data");
return new Response(body, { headers: SSE_HEADERS });

// Resume after HITL suspension
const body = eventStream.resume(checkpointId, [
  { toolCallId: "tc_abc", approved: true },
  { toolCallId: "tc_xyz", approved: false },
]);
return new Response(body, { headers: SSE_HEADERS });
```

**SSE event names** (dot-notation, distinct from legacy `@agentgrid/builder-sdk`):

| RunEvent kind | SSE event name | When |
|---------------|---------------|------|
| `turn_start`, `turn_end`, `warning`, `exceeded` | `run.status` | Turn lifecycle + budget |
| `tool_call` | `tool.invoke` | Before each tool executes |
| `tool_result` | `tool.result` | After each tool returns |
| `error` | `run.error` | On error |
| `complete` | `run.done` | Run exits |

**`SSE_HEADERS`** — `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`.

### Next.js

```typescript
// app/api/agent/route.ts
import { createAgent, toNextHandler } from "@etagents/sdk";
import type { NextRouteRequest } from "@etagents/sdk";

const agent = createAgent({ name: "assistant", systemPrompt: "..." });

export const POST = toNextHandler(agent, {
  // Optional per-request config resolver
  resolveConfig: (req: NextRouteRequest) => ({
    runId: req.headers.get("x-session-id") ?? undefined,
    maxTurns: 20,
  }),
});
```

Import path for tree-shaking: `@etagents/sdk/next`.

### Express

```typescript
import { createAgent, toExpressHandler } from "@etagents/sdk";

const agent = createAgent({ name: "assistant", systemPrompt: "..." });

app.post("/api/agent", toExpressHandler(agent, {
  resolveConfig: (req) => ({ runId: req.headers["x-session-id"] }),
}));
```

Import path for tree-shaking: `@etagents/sdk/express`.

### SessionEventSource (client)

```typescript
// @etagents/sdk/client — browser / Node / Deno / Bun
import { SessionEventSource } from "@etagents/sdk";

const source = new SessionEventSource("/api/agent", {
  body: { prompt: "What is the capital of France?" },
});

// Typed callbacks
source.on("tool.invoke", (event) => console.log("Calling tool:", event.kind));
source.on("run.done", (event) => {
  if (event.kind === "complete") console.log("Result:", event.result.response);
});

// Or async iteration
for await (const event of source) {
  console.log(event.kind);
}

// Or await the full result
const result = await source.result;
```

`.abort()` cancels the SSE connection. `.readyState` is `"connecting" | "open" | "closed"`.

---

## Scanner

`ToolScanner` discovers agent files and MCP configs on the filesystem. It is a standalone utility — zero SDK-internal dependencies. Use it programmatically when you need to build tooling on top of the scan results (e.g. a custom build step or a dev-server watcher), rather than going through the CLI.

```typescript
import { ToolScanner } from "@etagents/sdk";

// Scan for agent files only (default)
const result = await ToolScanner.scan("./src/agents");

for (const a of result.agents) {
  console.log(a.file); // absolute path to *.agent.ts / *.agent.js
}

// Also collect MCP configs
const full = ToolScanner.scan("./src", { agents: true, mcp: true });

for (const m of full.mcpConfigs) {
  console.log(m.serverName, m.transport); // from *.mcp.json
}
```

**`ScanOptions`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agents` | `boolean` | `true` | Find `*.agent.ts` / `*.agent.js` files |
| `mcp` | `boolean` | `false` | Find `*.mcp.json` config files |

**`ScanResult`:**

```typescript
interface ScanResult {
  agents: ScannedAgent[];     // { file: string }  — absolute paths
  mcpConfigs: ScannedMcp[];   // { file, serverName?, transport? }
}
```

Throws synchronously if the target directory does not exist. `node_modules` and dotfile directories are always skipped.

The `eta scan` command is a thin CLI wrapper over `ToolScanner.scan()`.

---

## CLI

The `eta` binary is installed when you add `@etagents/sdk` and provides 12 commands.

```bash
# Interactive REPL
eta chat ./my-agent.ts --provider anthropic

# Single-shot run
eta run ./my-agent.ts "What is the capital of France?"

# Execute a specific tool directly (bypasses LLM)
eta exec ./my-agent.ts search_database --args '{"query":"Q4 sales"}'

# Session management
eta session list --store .sessions
eta session get <run-id> --store .sessions
eta session delete <run-id> --store .sessions

# Vector memory operations
eta memory index <run-id> --store .sessions
eta memory search "user preferences" --top-k 5

# Multi-agent routing
eta orchestrate ./coordinator.ts --agents ./agents/ --prompt "Research and write a report"

# Expose tools as an MCP server
eta serve ./my-agent.ts

# Type-check and validate agent file
eta build ./my-agent.ts

# Discover agent and MCP config files in a directory
eta scan ./src

# Inspect agent structure and tool schemas
eta inspect ./my-agent.ts

# Scaffold a new agent
eta init my-agent

# PII masking utility
eta mask "Email bob@acme.com" --rules email,phone
```

| Command | Description |
|---------|-------------|
| `eta run` | Execute an agent against a prompt |
| `eta chat` | Interactive REPL |
| `eta exec` | Execute a single tool directly |
| `eta session` | Session CRUD — list, get, delete |
| `eta memory` | Vector memory — index, search |
| `eta orchestrate` | Route a prompt through a multi-agent pool |
| `eta serve` | Start tools as an MCP server (stdio) |
| `eta build` | Type-check and validate an agent file |
| `eta scan` | Discover agent files and MCP configs |
| `eta inspect` | Display agent structure and tool schemas |
| `eta init` | Scaffold a new agent project |
| `eta mask` | PII masking utility |

---

## API Reference

### Exports from `@etagents/sdk`

#### Agent API

| Export | Description |
|--------|-------------|
| `createAgent(config)` | Resolve config + defaults → frozen `AgentDef` |
| `defineTool(config)` | Zod-parametrised `ToolDef` factory |
| `executeTool(tool, args)` | Standalone tool execution with validation |

#### Kernel

| Export | Description |
|--------|-------------|
| `startRun(agent, input, config?)` | Run an agent to completion |
| `continueRun(checkpointId, decisions, config)` | Resume from HITL suspension |

#### Model Providers

| Export | Description |
|--------|-------------|
| `AnthropicModel` | Anthropic Messages API (streaming via raw SSE) |
| `OpenAIModel` | OpenAI chat completions |
| `AzureModel` | Azure OpenAI (extends `OpenAIModel`) |
| `GeminiModel` | Google Gemini generateContent + internal `SchemaTransformer` |
| `MockModel` | Deterministic scripted responses for testing |

#### Memory Providers

| Export | Description |
|--------|-------------|
| `InMemory` | Cosine similarity over in-process array |
| `RedisMemory` | Redis Stack + embedding vectors |

#### Store Providers

| Export | Description |
|--------|-------------|
| `FileStore` | JSON files on local disk |
| `RedisStore` | Redis key-value |

#### Privacy Providers

| Export | Description |
|--------|-------------|
| `RegexPrivacy` | Rule-based PII masking with placeholder format `⟨eta:…⟩` |
| `BUILTIN_RULES` | `email`, `phone`, `ssn`, `creditCard`, `ipv4` |

#### Orchestration

| Export | Description |
|--------|-------------|
| `AgentRouter` | Multi-agent dispatcher (builder pattern) |
| `RuleRouter` | Deterministic regex-based routing strategy |
| `TriageRouter` | LLM-based routing strategy |

#### HTTP / SSE

| Export | Description |
|--------|-------------|
| `SessionEventStream` | Server-side SSE producer wrapping `startRun`/`continueRun` |
| `SessionEventSource` | Client-side typed SSE consumer |
| `SSE_HEADERS` | Standard SSE response headers |
| `toNextHandler` | Next.js App Router handler factory |
| `toExpressHandler` | Express middleware factory |

#### Insight

| Export | Description |
|--------|-------------|
| `runInsight(messages, model, config)` | Extract facts + summary from conversation |
| `INSIGHT_PROMPTS` | Default system/user prompt objects |

#### MCP

| Export | Description |
|--------|-------------|
| `McpClient` | Connects to external MCP servers |
| `McpServer` | Expose tools as an MCP server |

#### Scanner

| Export | Description |
|--------|-------------|
| `ToolScanner` | Static `scan(dir, options?)` — filesystem discovery for agent files and MCP configs |
| `ScanResult` | `{ agents: ScannedAgent[], mcpConfigs: ScannedMcp[] }` |
| `ScannedAgent` | `{ file: string }` — absolute path to a discovered agent file |
| `ScannedMcp` | `{ file, serverName?, transport? }` — parsed MCP config file |
| `ScanOptions` | `{ agents?: boolean, mcp?: boolean }` |

#### Config + Errors

| Export | Description |
|--------|-------------|
| `DEFAULT_CONFIG` | All runtime defaults (single source of truth) |
| `EtaError` | Base class — carries a `code` string for programmatic handling |
| `ModelError` | Code: `MODEL_ERROR` |
| `StoreError` | Code: `STORE_ERROR` |
| `MemoryError` | Code: `MEMORY_ERROR` |
| `PrivacyError` | Code: `PRIVACY_ERROR` |
| `ToolError` | Code: `TOOL_ERROR` |
| `McpError` | Code: `MCP_ERROR` |
| `BudgetError` | Code: `BUDGET_ERROR` |
| `CheckpointError` | Code: `CHECKPOINT_ERROR` |

### Sub-path Exports

| Import path | Contents |
|-------------|----------|
| `@etagents/sdk/next` | `toNextHandler`, `NextRouteRequest`, `NextRouteHandler` |
| `@etagents/sdk/express` | `toExpressHandler`, `ExpressRequest`, `ExpressResponse` |
| `@etagents/sdk/client` | `SessionEventSource` (browser-safe) |
| `@etagents/sdk/orchestration` | `AgentRouter`, `RuleRouter`, `TriageRouter` (tree-shakeable) |

### Default Config

```typescript
const DEFAULT_CONFIG = {
  maxTurns: 20,
  maxTokens: 8192,
  defaultModel: "claude-sonnet-4-6",
  hitlTimeoutMs: 120_000,      // 2 minutes
  memoryMinScore: 0.7,
  maxFacts: 30,
  maxPersistedMessages: 40,
  toolTimeoutMs: 30_000,        // 30 seconds
  maxToolContentLength: 8_000,
};
```

---

## Examples

| File | What it demonstrates |
|------|----------------------|
| [01-basic-run.ts](examples/01-basic-run.ts) | `createAgent` + single `startRun`, minimal config |
| [02-streaming.ts](examples/02-streaming.ts) | `onEvent` streaming — `turn_start`, `tool_call`, `complete` |
| [03-tools.ts](examples/03-tools.ts) | `defineTool` + Zod schemas, parallel and sequential dispatch |
| [04-memory.ts](examples/04-memory.ts) | `InMemory` provider — cross-run recall |
| [05-privacy.ts](examples/05-privacy.ts) | `RegexPrivacy` — PII masking round-trip |
| [06-hitl.ts](examples/06-hitl.ts) | HITL suspend + `continueRun` with approval decisions |
| [07-multi-agent.ts](examples/07-multi-agent.ts) | `AgentRouter` + `RuleRouter` |
| [08-mcp.ts](examples/08-mcp.ts) | Connect an MCP server — tools auto-registered |
| [09-custom-model.ts](examples/09-custom-model.ts) | Implement `ModelProvider` for a local Ollama instance |
| [10-custom-memory.ts](examples/10-custom-memory.ts) | Implement `MemoryProvider` (contract walkthrough) |

Run any example:

```bash
ANTHROPIC_API_KEY=sk-... npx tsx examples/01-basic-run.ts
```

---


---

## Contributing

### Prerequisites

- **Node.js ≥ 18** and **TypeScript ≥ 5.6**
- **Docker** — required only for Redis-backed features (`RedisStore`, `RedisMemory`). Skip if you point `REDIS_URL` at an existing Redis Stack instance.

### Setup

```bash
npm install
```

### Services (Redis — optional)

```bash
# Start Redis Stack (includes RediSearch for vector queries)
docker compose -f docker/docker-compose.yml up -d

# Verify
docker compose -f docker/docker-compose.yml ps
```

Add to `.env`:

```
REDIS_URL=redis://localhost:6379
```

Plain Redis will **not** work — `FT.CREATE` / `FT.SEARCH` require Redis Stack.

### Build and type-check

```bash
npm run build        # Compile to dist/
npm run typecheck    # Type-check without emitting
```

### Tests

```bash
npm test                          # All tests (unit + integration, no Redis)
ETA_REDIS_TESTS=1 npm test        # Include Redis integration tests
ETA_LIVE_TESTS=1 npm test         # Include live API tests (API key required)
```

---

<div align="center">

Part of the **everythingagents** (`etagents`) rebuild.
See [sdk-redo-plan.md](./sdk-redo-plan.md) for architecture decisions and [redo-plan.md](../redo-plan.md) for overall project context.

</div>
