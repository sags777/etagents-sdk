/**
 * DEFAULT_CONFIG — single source of truth for all runtime knobs.
 *
 * Override individual fields at the agent or run level; do not scatter
 * magic numbers through the codebase.
 */
export const DEFAULT_CONFIG = {
  /** Hard cap on turns before the run exits with ExitCode.MAX_TURNS */
  maxTurns: 20,

  /** Default token budget per run (prompt + completion combined) */
  maxTokens: 8192,

  /** Model ID used when no model provider is explicitly configured */
  defaultModel: "claude-sonnet-4-6",

  /**
   * Milliseconds to wait for a human-in-the-loop approval before the run
   * suspends automatically.
   */
  hitlTimeoutMs: 120_000,

  /**
   * Minimum similarity score (0–1) a memory match must reach to be
   * included in context injection.
   */
  memoryMinScore: 0.7,

  /** Maximum number of facts extracted per insight pass */
  maxFacts: 30,

  /**
   * Number of messages kept in full before the kernel summarises older
   * history to stay within the context window.
   */
  maxPersistedMessages: 40,

  /** Milliseconds before an individual tool call is forcibly timed out */
  toolTimeoutMs: 30_000,

  /**
   * Tool result content is truncated to this byte limit before being
   * appended to the message list to prevent runaway context growth.
   */
  maxToolContentLength: 8_000,
} as const;

export type DefaultConfig = typeof DEFAULT_CONFIG;
