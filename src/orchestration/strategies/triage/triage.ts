import { z } from "zod";
import type { AgentDef } from "../../../types/domain/agent.js";
import type { ModelProvider } from "../../../types/contracts/model.js";
import type {
  RoutingDecision,
  RoutingStrategy,
  RoutingContext,
} from "../rule/rule.js";
import { buildTriageRouterSystemPrompt } from "../../../lib/prompts.js";
import { stripJsonFences } from "../../../providers/model/shared/stream.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

const triageResponseSchema = z.object({
  selectedAgent: z.string().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// TriageRouter
// ---------------------------------------------------------------------------

export interface TriageRouterOptions {
  /** ModelProvider used for the routing call */
  model: ModelProvider;
  /** Pool of agents the router may select from */
  agents: AgentDef[];
}

/**
 * TriageRouter — LLM-based routing.
 *
 * Presents all registered agents to the model and lets it select the best
 * match for the incoming message. Parsing errors fall back to the first agent
 * in the list with `confidence: 0` rather than throwing, keeping the router
 * fail-open.
 *
 * Usage:
 * ```ts
 * const strategy = new TriageRouter({ model, agents: [researchAgent, billingAgent] });
 * const decision = await strategy.route("What is my current invoice total?");
 * ```
 */
export class TriageRouter implements RoutingStrategy {
  private readonly model: ModelProvider;
  private readonly agents: AgentDef[];
  private readonly systemPrompt: string;

  constructor({ model, agents }: TriageRouterOptions) {
    if (agents.length === 0)
      throw new Error("TriageRouter: agents array must not be empty");
    this.model = model;
    this.agents = agents;
    this.systemPrompt = buildTriageRouterSystemPrompt(agents);
  }

  async route(
    message: string,
    _context?: RoutingContext,
  ): Promise<RoutingDecision> {
    const agentIndex = new Map(this.agents.map((a) => [a.name, a]));

    try {
      const response = await this.model.complete([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: message },
      ]);

      const rawContent =
        typeof response.message.content === "string"
          ? response.message.content
          : "";

      const raw = stripJsonFences(rawContent);

      if (!raw) {
        return {
          assignments: [{ agentDef: this.agents[0], parallel: false }],
          confidence: 0,
          reason: `Triage model returned empty response; falling back to ${this.agents[0].name}.`,
          strategy: "triage",
        };
      }

      const parsed = triageResponseSchema.safeParse(JSON.parse(raw));

      if (!parsed.success) {
        return {
          assignments: [{ agentDef: this.agents[0], parallel: false }],
          confidence: 0,
          reason: `Triage model returned unparseable JSON; falling back to ${this.agents[0].name}.`,
          strategy: "triage",
        };
      }

      const {
        selectedAgent,
        confidence: rawConfidence,
        reason: rawReason,
      } = parsed.data;

      const name =
        typeof selectedAgent === "string" ? selectedAgent.trim() : "";
      const confidence =
        typeof rawConfidence === "number"
          ? Math.max(0, Math.min(1, rawConfidence))
          : 0.5;
      const reason =
        typeof rawReason === "string"
          ? rawReason
          : "Agent selected by triage model.";

      const matched = agentIndex.get(name);
      if (!matched) {
        // Model returned an unrecognised name — fall back to first agent
        return {
          assignments: [{ agentDef: this.agents[0], parallel: false }],
          confidence: 0,
          reason: `Triage model returned unknown agent "${name}"; falling back to ${this.agents[0].name}.`,
          strategy: "triage",
        };
      }

      return {
        assignments: [{ agentDef: matched, parallel: false }],
        confidence,
        reason,
        strategy: "triage",
      };
    } catch (err) {
      // Fail-open: parse or network error → fall back to first agent
      return {
        assignments: [{ agentDef: this.agents[0], parallel: false }],
        confidence: 0,
        reason: `Triage model call failed (${err instanceof Error ? err.message : String(err)}); falling back to ${this.agents[0].name}.`,
        strategy: "triage",
      };
    }
  }
}
