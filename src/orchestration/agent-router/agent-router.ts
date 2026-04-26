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
 * whichever agent(s) the configured {@link RoutingStrategy} selects.
 *
 * Supports fan-out: when `RoutingDecision.assignments` contains multiple
 * entries marked `parallel: true`, they are run concurrently via
 * `Promise.all()`. Sequential assignments run one-at-a-time.
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
 * console.log(result.agentResults);  // per-agent sub-results
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
   * Route `message` to the best-matched agent(s) and execute runs.
   *
   * - Single-assignment routing: equivalent to a direct `startRun()`.
   * - Multi-assignment fan-out: parallel assignments run concurrently; the
   *   primary `RunResult` is from the first assignment.
   * - `agentResults` in the returned `RunResult` is keyed by agent name.
   * - `agent_routed` and `agent_complete` events are emitted to `config.onEvent`.
   *
   * @param message  The user's input.
   * @param config   Optional run-level overrides (maxTurns, budget, etc.).
   * @returns        The {@link RunResult} from the first assignment, with
   *                 `agentResults` populated for all assignments.
   */
  async run(message: string, config: RunConfig = {}): Promise<RunResult> {
    if (this.agents.length === 0) {
      throw new Error("AgentRouter: no agents registered");
    }

    const decision = await this.strategy.route(message);
    const { assignments, confidence, reason } = decision;

    if (assignments.length === 0) {
      throw new Error("AgentRouter: routing strategy returned an empty assignments array");
    }

    const emit = config.onEvent;

    // Emit agent_routed for each assignment
    for (const a of assignments) {
      emit?.({ kind: "agent_routed", agentName: a.agentDef.name, confidence, reason });
    }

    // Separate parallel from sequential
    const parallelAssignments = assignments.filter((a) => a.parallel);
    const sequentialAssignments = assignments.filter((a) => !a.parallel);

    // Run parallel assignments concurrently
    const parallelResults = await Promise.all(
      parallelAssignments.map(async (a) => {
        const result = await startRun(a.agentDef, a.subPrompt ?? message, config);
        emit?.({ kind: "agent_complete", agentName: a.agentDef.name, result });
        return { name: a.agentDef.name, result };
      }),
    );

    // Run sequential assignments one-at-a-time
    const serialResults: Array<{ name: string; result: RunResult }> = [];
    for (const a of sequentialAssignments) {
      const result = await startRun(a.agentDef, a.subPrompt ?? message, config);
      emit?.({ kind: "agent_complete", agentName: a.agentDef.name, result });
      serialResults.push({ name: a.agentDef.name, result });
    }

    // Collect per-agent results keyed by name
    const agentResults: Record<string, RunResult> = {};
    for (const { name, result } of [...parallelResults, ...serialResults]) {
      agentResults[name] = result;
    }

    // Primary result: first sequential result, falling back to first parallel
    const primaryName = assignments[0].agentDef.name;
    const primaryResult = agentResults[primaryName];

    return { ...primaryResult, agentResults };
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
