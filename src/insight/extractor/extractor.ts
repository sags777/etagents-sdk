import type { Message } from "../../types/message.js";
import type { ModelProvider } from "../../interfaces/model.js";
import type { InsightConfig, InsightResult } from "../../types/insight.js";
import { DEFAULT_CONFIG } from "../../config.js";
import { INSIGHT_PROMPTS } from "../prompts/prompts.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TRANSCRIPT_CHARS = 12_000;
const NEAR_DUPLICATE_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Levenshtein edit distance — own implementation
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings using a
 * standard dynamic-programming table.
 */
function editDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  // Allocate a (aLen+1) × (bLen+1) grid initialised to 0
  const grid: number[][] = Array.from({ length: aLen + 1 }, () =>
    new Array<number>(bLen + 1).fill(0),
  );

  // Base cases: transforming empty prefix costs one insertion per character
  for (let i = 0; i <= aLen; i++) grid[i][0] = i;
  for (let j = 0; j <= bLen; j++) grid[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      if (a[i - 1] === b[j - 1]) {
        grid[i][j] = grid[i - 1][j - 1];
      } else {
        grid[i][j] =
          1 +
          Math.min(
            grid[i - 1][j],   // deletion
            grid[i][j - 1],   // insertion
            grid[i - 1][j - 1], // substitution
          );
      }
    }
  }

  return grid[aLen][bLen];
}

/**
 * Normalised similarity in [0, 1].
 * Returns 1 for identical strings, 0 when one string is empty.
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - editDistance(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalise(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Three-tier deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate `candidates` and return a capped result array.
 *
 * Tier 1 — exact normalised match: skip the candidate.
 * Tier 2 — near-duplicate (Levenshtein similarity ≥ threshold): skip.
 * Tier 3 — cap: slice the pool to `cap` entries once all candidates are processed.
 *
 * Eviction policy: entries appended later (task-outcome facts) are positioned
 * at the end of the pool and are therefore evicted first when the cap is hit.
 * Identity / user facts should be passed in a separate array with a generous cap.
 */
function deduplicate(candidates: string[], cap: number): string[] {
  const pool: string[] = [];
  const normPool: string[] = [];

  for (const candidate of candidates) {
    const norm = normalise(candidate);

    // Tier 1: exact normalised match
    if (normPool.includes(norm)) continue;

    // Tier 2: near-duplicate via edit distance
    const nearDup = normPool.some(
      (existing) => similarity(norm, existing) >= NEAR_DUPLICATE_THRESHOLD,
    );
    if (nearDup) continue;

    pool.push(candidate);
    normPool.push(norm);
  }

  // Tier 3: cap — later entries (task-outcome) are evicted first
  return pool.slice(0, cap);
}

// ---------------------------------------------------------------------------
// runInsight
// ---------------------------------------------------------------------------

/**
 * Run a post-turn insight pass against the message history.
 *
 * Calls the model with the extraction prompt, parses the response JSON,
 * deduplicates facts across all three tiers, and returns a structured
 * {@link InsightResult}.
 *
 * Always succeeds — returns empty arrays on model or parse failure so the
 * caller's run loop is never interrupted.
 */
export async function runInsight(
  messages: Message[],
  model: ModelProvider,
  config: InsightConfig,
): Promise<InsightResult> {
  const maxFacts = config.maxFacts ?? DEFAULT_CONFIG.maxFacts;

  // Build transcript from user/assistant turns only to reduce token cost
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const bounded =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(-MAX_TRANSCRIPT_CHARS)
      : transcript;

  const systemPrompt = config.prompts?.extractFacts ?? INSIGHT_PROMPTS.extract.system;

  try {
    const response = await model.complete([
      { role: "system", content: systemPrompt },
      { role: "user", content: INSIGHT_PROMPTS.extract.user(bounded) },
    ]);

    const raw =
      typeof response.message.content === "string"
        ? response.message.content
        : "";

    const parsed = JSON.parse(raw) as {
      facts?: unknown;
      userFacts?: unknown;
      summary?: unknown;
      topics?: unknown;
    };

    const rawFacts = Array.isArray(parsed.facts)
      ? parsed.facts.filter((f): f is string => typeof f === "string")
      : [];

    const rawUserFacts = Array.isArray(parsed.userFacts)
      ? parsed.userFacts.filter((f): f is string => typeof f === "string")
      : [];

    const summary = typeof parsed.summary === "string" ? parsed.summary : "";

    const rawTopics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t): t is string => typeof t === "string")
      : [];

    // user facts are identity-level and protected — generous cap, never evicted
    const userFacts = deduplicate(rawUserFacts, 10);

    // regular facts are evictable — capped at maxFacts
    const facts = deduplicate(rawFacts, maxFacts);

    return { facts, userFacts, summary, topics: rawTopics };
  } catch {
    // Fail-open: insight errors must not break the enclosing agent run
    return { facts: [], userFacts: [], summary: "", topics: [] };
  }
}
