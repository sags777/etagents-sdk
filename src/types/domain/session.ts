import type { Message } from "./message.js";
import type { TokenUsage } from "../contracts/model.js";
import type { PrivacyMap } from "../contracts/privacy.js";

// ---------------------------------------------------------------------------
// Session snapshot (persisted to store)
// ---------------------------------------------------------------------------

/**
 * SessionInsights — consumer-readable extracted insights from a run.
 *
 * Stored in `RunRecord.metadata` under the `"insights"` key.
 */
export interface SessionInsights {
  facts: string[];
  userFacts: string[];
  summary: string;
  topics: string[];
}

/**
 * KernelMeta — kernel-private bookkeeping stored inside the snapshot.
 *
 * Never expose these fields to end users.
 */
export interface KernelMeta {
  privacyMap?: PrivacyMap;
  tokenUsage?: TokenUsage;
  /** SHA-256 of the AgentConfig used to produce this snapshot */
  configFingerprint?: string;
}

/**
 * SessionSnapshot — the full serialisable state for a run.
 *
 * `insights` holds consumer-readable extracted facts, summaries, and topics.
 * `_kernel` holds internal bookkeeping that the kernel reads back on resume.
 */
export interface SessionSnapshot {
  version: 1;
  runId: string;
  messages: Message[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Consumer-readable extracted insights. */
  insights: SessionInsights;
  /** Kernel-private bookkeeping — never surface to consumers. */
  _kernel: KernelMeta;
}
