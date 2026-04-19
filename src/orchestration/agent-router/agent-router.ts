import { startRun } from "../../kernel/run/run.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunConfig, RunResult } from "../../types/run.js";
import type { RoutingStrategy } from "../rule-router/rule-router.js";

// ---------------------------------------------------------------------------
// AgentRouter
// ---------------------------------------------------------------------------

/**
 * AgentRouter — top-level multi-agent dispatcher.
 *
 * Holds a pool of registered agents and delegates each incoming message to
 * whichever agent the configured {@link RoutingStrategy} selects.
 *
 * Usage (builder pattern):
 * ```ts
 * const router = AgentRouter.create()
 *   .add(researchAgent)
 *   .add(billingAgent)
 *   .withStrategy(new TriageRouter({ model, agents: [researchAgent, billingAgent] }))
 *   .build();
 *
 * const result = await router.run("What is my current invoice total?");
 * ```
 */
export class AgentRouter {
  /** @internal — use `AgentRouter.create()` builder instead */
  constructor(
    private readonly agents: AgentDef[],
    private readonly strategy: RoutingStrategy,
  ) {}

  // ---------------------------------------------------------------------------
  // Builder
  // ---------------------------------------------------------------------------

  /** Start building an AgentRouter. */
  static create(): AgentRouterBuilder {
    return new AgentRouterBuilder();
  }

  // ---------------------------------------------------------------------------
  // run
  // ---------------------------------------------------------------------------

  /**
   * Route `message` to the best-matched agent and execute a kernel run.
   *
   * The routing decision is made by the configured strategy. The selected
   * agent's `startRun` is then called with the original message and any
   * supplied `RunConfig` overrides.
   *
   * @param message  The user's input.
   * @param config   Optional run-level overrides (maxTurns, budget, etc.).
   * @returns        The {@link RunResult} from the selected agent's run.
   */
  async run(message: string, config: RunConfig = {}): Promise<RunResult> {
    if (this.agents.length === 0) {
      throw new Error("AgentRouter: no agents registered");
    }

    const decision = await this.strategy.route(message);
    return startRun(decision.agentDef, message, config);
  }
}

// ---------------------------------------------------------------------------
// AgentRouterBuilder
// ---------------------------------------------------------------------------

class AgentRouterBuilder {
  private readonly _agents: AgentDef[] = [];
  private _strategy: RoutingStrategy | undefined;

  /**
   * Add an agent to the router's pool.
   * Agents must be added before calling `build()`.
   */
  add(agent: AgentDef): this {
    this._agents.push(agent);
    return this;
  }

  /**
   * Set the routing strategy.
   * Must be called exactly once before `build()`.
   */
  withStrategy(strategy: RoutingStrategy): this {
    this._strategy = strategy;
    return this;
  }

  /**
   * Freeze the builder and return a ready-to-use {@link AgentRouter}.
   */
  build(): AgentRouter {
    if (!this._strategy) {
      throw new Error("AgentRouter: a strategy must be set via .withStrategy() before build()");
    }
    return new AgentRouter([...this._agents], this._strategy);
  }
}
