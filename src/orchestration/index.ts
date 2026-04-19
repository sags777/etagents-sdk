/**
 * @module @etagents/sdk/orchestration
 *
 * Multi-agent routing. Sits above the kernel — routes messages to the right agent.
 */

export { AgentRouter } from "./agent-router/agent-router.js";
export { RuleRouter } from "./rule-router/rule-router.js";
export { TriageRouter } from "./triage-router/triage-router.js";
export type { RoutingDecision, RoutingStrategy, RoutingContext } from "./rule-router/rule-router.js";
export type { TriageRouterOptions } from "./triage-router/triage-router.js";
