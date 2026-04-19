import type { AgentDef } from "../../types/agent.js";

// ---------------------------------------------------------------------------
// RoutingDecision — result returned by any RoutingStrategy
// ---------------------------------------------------------------------------

/**
 * RoutingDecision — the output of a routing pass.
 *
 * `confidence` is a value in [0, 1] expressing how certain the strategy is
 * about the selected agent. Deterministic strategies always emit 1.
 */
export interface RoutingDecision {
  agentDef: AgentDef;
  confidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// RoutingStrategy — contract for all router implementations
// ---------------------------------------------------------------------------

/**
 * RoutingContext — extra state the router may inspect.
 *
 * Kept lightweight by design; extend in consuming applications as needed.
 */
export interface RoutingContext {
  /** Optional prior conversation history for stateful routing */
  history?: string[];
  /** Arbitrary caller-provided metadata */
  metadata?: Record<string, unknown>;
}

/**
 * RoutingStrategy — contract every router must satisfy.
 */
export interface RoutingStrategy {
  route(message: string, context?: RoutingContext): Promise<RoutingDecision>;
}

// ---------------------------------------------------------------------------
// RuleRouter — deterministic pattern-based routing
// ---------------------------------------------------------------------------

interface RuleEntry {
  pattern: RegExp;
  agent: AgentDef;
}

/**
 * RuleRouter — rule-based routing with zero LLM calls.
 *
 * Usage:
 * ```ts
 * const strategy = new RuleRouter()
 *   .when(/\binvoice\b/i, billingAgent)
 *   .when("support ticket", helpDeskAgent)
 *   .fallback(generalAgent)
 *   .build();
 * ```
 *
 * Rules are evaluated in insertion order. The first matching pattern wins.
 * If no pattern matches and a fallback agent is registered, it is returned
 * with `confidence: 0.5` to signal the match was indirect.
 * Throws when `route()` is called with no matching rule and no fallback.
 */
export class RuleRouter {
  private readonly rules: RuleEntry[] = [];
  private fallbackAgent: AgentDef | undefined;
  private built = false;

  /**
   * Register a routing rule.
   *
   * @param pattern  A `RegExp` or a literal string (converted to a
   *                 case-insensitive fixed-string regex).
   * @param agent    The agent to route to when the pattern matches.
   */
  when(pattern: RegExp | string, agent: AgentDef): this {
    if (this.built) throw new Error("RuleRouter: cannot add rules after build()");
    const re =
      typeof pattern === "string"
        ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        : pattern;
    this.rules.push({ pattern: re, agent });
    return this;
  }

  /**
   * Register a catch-all agent used when no rule matches.
   */
  fallback(agent: AgentDef): this {
    if (this.built) throw new Error("RuleRouter: cannot set fallback after build()");
    this.fallbackAgent = agent;
    return this;
  }

  /**
   * Freeze the router and return it as a {@link RoutingStrategy}.
   */
  build(): RoutingStrategy {
    this.built = true;

    const rules = [...this.rules];
    const fallback = this.fallbackAgent;

    return {
      route: async (message: string): Promise<RoutingDecision> => {
        for (const { pattern, agent } of rules) {
          if (pattern.test(message)) {
            return {
              agentDef: agent,
              confidence: 1,
              reason: `Pattern /${pattern.source}/ matched the input.`,
            };
          }
        }

        if (fallback) {
          return {
            agentDef: fallback,
            confidence: 0.5,
            reason: "No rule matched — routed to fallback agent.",
          };
        }

        throw new Error(
          `RuleRouter: no rule matched the message and no fallback is configured. ` +
            `Message preview: "${message.slice(0, 80)}"`,
        );
      },
    };
  }
}
