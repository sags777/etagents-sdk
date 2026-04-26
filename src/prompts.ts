// ---------------------------------------------------------------------------
// Prompts — centralised export of all SDK prompt strings and builders
// ---------------------------------------------------------------------------

// ── Insight prompts ────────────────────────────────────────────────────────

/**
 * INSIGHT_PROMPTS — typed prompt objects for the insight (reflection) pass.
 *
 * Keeping prompts as typed objects rather than inline strings lets callers
 * inspect and override individual fields without string manipulation.
 */
export const INSIGHT_PROMPTS = {
  /**
   * extract — post-conversation fact and summary extraction.
   *
   * Instructs the model to produce a structured JSON object from the
   * conversation transcript.
   */
  extract: {
    system: `You are a post-conversation analyst. Read the transcript and return ONLY a valid JSON object — no markdown fences, no commentary:

{
  "facts": ["session fact", ...],
  "userFacts": ["identity fact about the user", ...],
  "summary": "One sentence describing the primary outcome.",
  "topics": ["keyword", ...]
}

## facts (up to 10, evictable)
Concrete decisions, confirmed outcomes, and established context from this session.
Rules:
- Include only what was DECIDED, CONFIRMED, or RESOLVED — not questions or lookups
- Every entry must be a complete sentence with no ambiguous pronouns
- BAD: "The user asked about the deployment pipeline." (a query)
- GOOD: "The team agreed to use blue-green deployments for the next release."

## userFacts (up to 3, permanent — must not be evicted)
Identity-level facts about who the user is: name, role, organisation, expertise domain, strategic intent.
Rules:
- Only capture what the user explicitly states about themselves
- BAD: "The user wants a report generated." (a task request, not identity)
- GOOD: "The user is Jordan, a principal engineer at FinCo."

## summary
A single sentence. What was the main accomplishment or intent of the conversation?

## topics
Two to five short keyword labels covering the main subjects discussed.`,

    user: (conversation: string): string => conversation,
  },

  /**
   * hypothesize — speculative question-answering from stored knowledge.
   *
   * Used when the kernel wants to infer an answer from prior context
   * without making a live LLM call against the full conversation.
   */
  hypothesize: {
    system: `You are a knowledge synthesizer. Answer the question using only what you know and return ONLY a valid JSON object:

{
  "answer": "Direct answer to the question.",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation of how you arrived at this answer."
}`,

    user: (query: string): string => query,
  },
} as const;

// ── Orchestration prompts ──────────────────────────────────────────────────

/**
 * TRIAGE_ROUTER_SYSTEM_PROMPT_TEMPLATE
 *
 * The static preamble and response schema for the LLM-based triage router.
 * Use `buildTriageRouterSystemPrompt` to inject the agent catalogue at
 * runtime.
 */
export const TRIAGE_ROUTER_SYSTEM_PROMPT_TEMPLATE = `You are a routing coordinator. Your sole job is to read a user message and select the most suitable specialist agent to handle it.

Available agents:
{{catalogue}}

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

/**
 * Build the triage router system prompt with the agent catalogue injected.
 *
 * @param agents - Array of `{ name: string; systemPrompt: string }` entries.
 */
export function buildTriageRouterSystemPrompt(
  agents: Array<{ name: string; systemPrompt: string }>,
): string {
  const catalogue = agents
    .map((a, i) => `${i + 1}. ${a.name} — ${a.systemPrompt.slice(0, 120).replace(/\n/g, " ")}`)
    .join("\n");

  return TRIAGE_ROUTER_SYSTEM_PROMPT_TEMPLATE.replace("{{catalogue}}", catalogue);
}

// ── Kernel prompts ─────────────────────────────────────────────────────────

/**
 * MEMORY_PIPE_HYDE_SYSTEM_PROMPT
 *
 * System prompt for the HyDE (Hypothetical Document Embeddings) step inside
 * `MemoryPipe.retrieve()`. The model is asked to generate a short hypothetical
 * answer that is then used as the vector-search query instead of the raw user
 * input, improving recall quality.
 */
export const MEMORY_PIPE_HYDE_SYSTEM_PROMPT =
  "Generate a brief, concrete hypothetical answer to the user's question. " +
  "This will be used as a search query to retrieve relevant memory. " +
  "Respond with only the hypothetical answer text, nothing else.";

// ── CLI / scaffolding prompts ──────────────────────────────────────────────

/**
 * CLI_DEFAULT_AGENT_SYSTEM_PROMPT
 *
 * Default system prompt written into newly scaffolded agent files by
 * `eta init`. Intended as a starting-point placeholder that users replace
 * with domain-specific instructions.
 */
export const CLI_DEFAULT_AGENT_SYSTEM_PROMPT =
  "You are a helpful assistant. Be concise and accurate.";
