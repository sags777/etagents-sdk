/**
 * @module @etagents/sdk/agent
 *
 * Public-facing agent definition API. Create agents, define tools, execute tools.
 */

export { defineTool } from "./define-tool/define-tool.js";
export type { ToolConfig } from "../types/tool.js";
export { executeTool } from "./executor/executor.js";
export type { ToolContext, ToolExecResult } from "../types/tool.js";
export { createAgent } from "./create-agent/create-agent.js";
export { cloneAgent } from "./clone-agent/clone-agent.js";
export { agentAsTool } from "./agent-as-tool/agent-as-tool.js";
export type { AgentAsToolConfig } from "./agent-as-tool/agent-as-tool.js";
export { agentToManifest } from "./manifest.js";
export type { AgentManifest } from "./manifest.js";
