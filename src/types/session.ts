import type { Message } from "./message.js";
import type { TokenUsage } from "../interfaces/model.js";
import type { PrivacyMap } from "../interfaces/privacy.js";

// ---------------------------------------------------------------------------
// Session snapshot (persisted to store)
// ---------------------------------------------------------------------------

/**
 * SessionSnapshot — the full serialisable state for a run.
 *
 * Stored under `runId` in the StoreProvider. The `__eta` key holds
 * internal bookkeeping that the kernel reads back on resume.
 */
export interface SessionSnapshot {
  version: 1;
  runId: string;
  messages: Message[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  __eta: SnapshotMeta;
}

/**
 * SnapshotMeta — internal bookkeeping stored inside the snapshot.
 *
 * Never expose these fields to the end user; they are kernel-private.
 */
export interface SnapshotMeta {
  facts?: string[];
  summary?: string;
  privacyMap?: PrivacyMap;
  tokenUsage?: TokenUsage;
  /** Hash of the AgentConfig used to produce this snapshot */
  configFingerprint?: string;
}
