import type { SessionSnapshot } from "./session.js";

// ---------------------------------------------------------------------------
// HITL checkpoint types
// ---------------------------------------------------------------------------

/**
 * PendingApproval — a tool call that requires human approval before
 * the kernel will execute it.
 */
export interface PendingApproval {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  agentName: string;
}

/**
 * ApprovalDecision — the human's verdict on a pending approval.
 *
 * `approved: false` causes the kernel to skip the tool and inject a
 * synthetic error result so the model can recover.
 */
export interface ApprovalDecision {
  approved: boolean;
  toolCallId: string;
}

/**
 * SuspendSnapshot — the full state persisted when a run is suspended
 * awaiting one or more HITL approvals.
 */
export interface SuspendSnapshot {
  session: SessionSnapshot;
  pendingApprovals: PendingApproval[];
  suspendedAt: string;
}
