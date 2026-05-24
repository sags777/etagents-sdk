/**
 * @module @etagents/sdk/orchestration
 *
 * Multi-agent routing. Sits above the kernel — routes messages to the right agent.
 */

export { AgentRouter } from "./agent-router/agent-router.js";
export { RuleRouter } from "./strategies/rule/rule.js";
export { TriageRouter } from "./strategies/triage/triage.js";
export type {
  RoutingDecision,
  RoutingAssignment,
  RoutingStrategy,
  RoutingContext,
} from "./strategies/rule/rule.js";
export type { TriageRouterOptions } from "./strategies/triage/triage.js";
