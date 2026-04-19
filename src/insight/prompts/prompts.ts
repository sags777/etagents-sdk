// ---------------------------------------------------------------------------
// Insight prompt definitions
// ---------------------------------------------------------------------------

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
