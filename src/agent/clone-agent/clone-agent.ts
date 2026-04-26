import type { AgentConfig, AgentDef } from "../../types/agent.js";
import { createAgent } from "../create-agent/create-agent.js";

/**
 * cloneAgent — produce a new `AgentDef` from an existing one with selective overrides.
 *
 * Useful for multi-tenant scenarios where most config is shared but one or two
 * providers (model, store, privacy) differ per request.
 *
 * All resolved providers from `base` are carried forward unless explicitly
 * replaced in `overrides`.  The returned `AgentDef` is a new frozen object —
 * `base` is never mutated.
 *
 * @example
 * // Swap only the model for a cheaper tier
 * const fastAgent = cloneAgent(agent, { model: "claude-haiku-4-5-20251001" });
 *
 * @example
 * // Tenant-scoped store and privacy — everything else inherited
 * const tenantAgent = cloneAgent(baseAgent, { store: tenantStore, privacy: tenantPrivacy });
 */
export function cloneAgent(base: AgentDef, overrides: Partial<AgentConfig> = {}): AgentDef {
  return createAgent({ ...base, ...overrides } as AgentConfig);
}
