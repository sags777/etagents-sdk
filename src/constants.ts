/**
 * Central constants module — single source of truth for all magic values.
 * Import from here; never hardcode these strings elsewhere in the kernel or providers.
 */

// ---------------------------------------------------------------------------
// Store key prefixes
// ---------------------------------------------------------------------------

export const STORE_KEYS = {
  SESSION_PREFIX: "eta:run:",
  SUSPEND_PREFIX: "eta:suspend:",
  TOOL_CACHE_PREFIX: "eta:tool-cache:",
  MEMORY_PREFIX: "eta:mem:",
  STORE_PREFIX: "eta:store:",
  // Normalized entity prefixes — used by PersistenceAdapter
  RUN_RECORD_PREFIX: "eta:run-record:",
  CHECKPOINT_PREFIX: "eta:checkpoint:",
  MESSAGES_PREFIX: "eta:messages:",
  APPROVALS_PREFIX: "eta:approvals:",
  ROUTING_DECISION_PREFIX: "eta:routing-decision:",
  TOOL_CALLS_PREFIX: "eta:tool-calls:",
  RUN_EVENTS_PREFIX: "eta:run-events:",
  AGENT_PROMPT_PREFIX: "eta:agent-prompt:",
} as const;

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export const MCP_NAMESPACE_SEPARATOR = "mcp__";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

export const MODEL_PREFIX_MAP = {
  ANTHROPIC: "claude-",
  OPENAI_GPT: "gpt-",
  OPENAI_O1: "o1",
  OPENAI_O3: "o3",
  OPENAI_O4: "o4",
  GEMINI: "gemini-",
} as const;

// ---------------------------------------------------------------------------
// HITL
// ---------------------------------------------------------------------------

export const HITL_DEFAULT_MODE = "none" as const;

// ---------------------------------------------------------------------------
// Error / log strings
// ---------------------------------------------------------------------------

export const STREAM_ERROR_CODE = "STREAM_ERROR";
export const LOG_PREFIX_KERNEL = "[eta:kernel]";
export const LOG_PREFIX_MCP_HUB = "[McpHub]";

// ---------------------------------------------------------------------------
// Numeric defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_HITL_TIMEOUT = 120_000;
export const DEFAULT_MEMORY_SCORE = 0.7;
export const DEFAULT_MAX_FACTS = 30;
export const DEFAULT_TOOL_TIMEOUT = 30_000;
export const DEFAULT_MAX_TOOL_BYTES = 8_000;

// ---------------------------------------------------------------------------
// Model-provider-specific
// ---------------------------------------------------------------------------

export const ANTHROPIC_API_VERSION = "2023-06-01";
export const GEMINI_SSE_PARAM = "alt=sse";
export const SSE_DONE_SENTINEL = "[DONE]";
export const SSE_DATA_PREFIX = "data: ";

// ---------------------------------------------------------------------------
// Memory namespace values
// ---------------------------------------------------------------------------

export const MEMORY_NAMESPACES = {
  AGENT: "agent",
  USER: "user",
  SESSION: "session",
  DEFAULT: "default",
} as const;
