import { nanoid } from "nanoid";
import { startRun } from "../../kernel/entry/start.js";
import { PersistenceAdapter } from "../../kernel/persist/persistence-adapter.js";
import type { AgentDef } from "../../types/domain/agent.js";
import type { RunConfig, RunResult } from "../../types/domain/run.js";
import { toRunSummary } from "../../types/domain/run.js";
import type { RoutingStrategy } from "../strategies/rule/rule.js";

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
    private readonly adapter: PersistenceAdapter | undefined,
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
    const { assignments, confidence, reason, strategy } = decision;

    if (assignments.length === 0) {
      throw new Error(
        "AgentRouter: routing strategy returned an empty assignments array",
      );
    }

    // Persist routing decision — best-effort so fan-out is never blocked.
    const decisionId = nanoid();
    const decisionCreatedAt = new Date().toISOString();
    if (this.adapter) {
      try {
        await this.adapter.saveRoutingDecision({
          decisionId,
          strategy,
          inputMessage: message,
          confidence,
          reason,
          assignments: assignments.map((a) => ({
            agentName: a.agentDef.name,
            parallel: a.parallel ?? false,
          })),
          createdAt: decisionCreatedAt,
        });
      } catch {
        // Best-effort — persistence failures must not block routing
      }
    }

    const emit = config.onEvent;

    // Emit agent_routed for each assignment
    for (const a of assignments) {
      emit?.({
        kind: "agent_routed",
        agentName: a.agentDef.name,
        confidence,
        reason,
      });
    }

    // Child run config includes routing lineage IDs
    const childConfig: RunConfig = {
      ...config,
      routingDecisionId: decisionId,
    };

    // Separate parallel from sequential
    const parallelAssignments = assignments.filter((a) => a.parallel);
    const sequentialAssignments = assignments.filter((a) => !a.parallel);

    // Run parallel assignments concurrently
    const parallelResults = await Promise.all(
      parallelAssignments.map(async (a) => {
        const result = await startRun(
          a.agentDef,
          a.subPrompt ?? message,
          childConfig,
        );
        emit?.({
          kind: "agent_complete",
          agentName: a.agentDef.name,
          result: toRunSummary(result),
        });
        return { name: a.agentDef.name, result };
      }),
    );

    // Run sequential assignments one-at-a-time
    const serialResults: Array<{ name: string; result: RunResult }> = [];
    for (const a of sequentialAssignments) {
      const result = await startRun(
        a.agentDef,
        a.subPrompt ?? message,
        childConfig,
      );
      emit?.({
        kind: "agent_complete",
        agentName: a.agentDef.name,
        result: toRunSummary(result),
      });
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
  private readonly agents: AgentDef[] = [];
  private strategy: RoutingStrategy | undefined;

  /**
   * Add an agent to the router's pool.
   * Agents must be added before calling `build()`.
   */
  add(agent: AgentDef): this {
    this.agents.push(agent);
    return this;
  }

  /**
   * Set the routing strategy.
   * Must be called exactly once before `build()`.
   */
  withStrategy(strategy: RoutingStrategy): this {
    this.strategy = strategy;
    return this;
  }

  /**
   * Freeze the builder and return a ready-to-use {@link AgentRouter}.
   *
   * Automatically wires a `PersistenceAdapter` using the first registered
   * agent's store for routing decision lineage. If no agents have been
   * added yet, routing decisions will not be persisted.
   */
  build(): AgentRouter {
    if (!this.strategy) {
      throw new Error(
        "AgentRouter: a strategy must be set via .withStrategy() before build()",
      );
    }
    const adapter = this.agents[0]?.store
      ? new PersistenceAdapter(this.agents[0].store)
      : undefined;
    return new AgentRouter([...this.agents], this.strategy, adapter);
  }
}
