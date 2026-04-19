import type { AgentDef } from "../../types/agent.js";
import type { ModelProvider } from "../../interfaces/model.js";
import type { RoutingDecision, RoutingStrategy, RoutingContext } from "../rule-router/rule-router.js";

// ---------------------------------------------------------------------------
// Triage prompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt that instructs the model how to select an agent.
 *
 * Listed agents are formatted as a numbered catalogue so the model can refer
 * to them by name unambiguously.
 */
function buildSystemPrompt(agents: AgentDef[]): string {
  const catalogue = agents
    .map((a, i) => `${i + 1}. ${a.name} — ${a.systemPrompt.slice(0, 120).replace(/\n/g, " ")}`)
    .join("\n");

  return `You are a routing coordinator. Your sole job is to read a user message and select the most suitable specialist agent to handle it.

Available agents:
${catalogue}

Respond with ONLY a valid JSON object — no markdown, no commentary:

{
  "selectedAgent": "<exact agent name from the list above>",
  "confidence": <number between 0 and 1>,
  "reason": "<one sentence explaining the selection>"
}

Rules:
- "selectedAgent" must exactly match one of the names in the list.
- "confidence" must be 0–1; use values below 0.5 when the message is ambiguous.
- If no agent clearly fits, select the closest match and lower confidence accordingly.`;
}

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
    if (agents.length === 0) throw new Error("TriageRouter: agents array must not be empty");
    this.model = model;
    this.agents = agents;
    this.systemPrompt = buildSystemPrompt(agents);
  }

  async route(message: string, _context?: RoutingContext): Promise<RoutingDecision> {
    const agentIndex = new Map(this.agents.map((a) => [a.name, a]));

    try {
      const response = await this.model.complete([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: message },
      ]);

      const raw =
        typeof response.message.content === "string" ? response.message.content : "";

      const parsed = JSON.parse(raw) as {
        selectedAgent?: unknown;
        confidence?: unknown;
        reason?: unknown;
      };

      const name =
        typeof parsed.selectedAgent === "string" ? parsed.selectedAgent.trim() : "";
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5;
      const reason =
        typeof parsed.reason === "string" ? parsed.reason : "Agent selected by triage model.";

      const matched = agentIndex.get(name);
      if (!matched) {
        // Model returned an unrecognised name — fall back to first agent
        return {
          agentDef: this.agents[0],
          confidence: 0,
          reason: `Triage model returned unknown agent "${name}"; falling back to ${this.agents[0].name}.`,
        };
      }

      return { agentDef: matched, confidence, reason };
    } catch {
      // Fail-open: parse or network error → fall back to first agent
      return {
        agentDef: this.agents[0],
        confidence: 0,
        reason: `Triage model call failed; falling back to ${this.agents[0].name}.`,
      };
    }
  }
}
