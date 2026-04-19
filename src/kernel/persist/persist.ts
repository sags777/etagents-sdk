import type { SessionSnapshot } from "../../types/session.js";
import type { SuspendSnapshot } from "../../types/checkpoint.js";
import type { StoreProvider } from "../../interfaces/store.js";

// ---------------------------------------------------------------------------
// Store key constants
// ---------------------------------------------------------------------------

const SESSION_PREFIX = "eta:run:";
const SUSPEND_PREFIX = "eta:suspend:";

// ---------------------------------------------------------------------------
// Session snapshot persistence
// ---------------------------------------------------------------------------

export async function persistRun(
  snapshot: SessionSnapshot,
  store: StoreProvider,
): Promise<void> {
  const updated: SessionSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
  await store.write(`${SESSION_PREFIX}${snapshot.runId}`, updated);
}

export async function loadRun(
  runId: string,
  store: StoreProvider,
): Promise<SessionSnapshot | null> {
  return store.read<SessionSnapshot>(`${SESSION_PREFIX}${runId}`);
}

export async function removeRun(runId: string, store: StoreProvider): Promise<void> {
  await store.remove(`${SESSION_PREFIX}${runId}`);
}

// ---------------------------------------------------------------------------
// Suspend snapshot persistence (HITL)
// ---------------------------------------------------------------------------

export async function persistSuspend(
  checkpointId: string,
  snapshot: SuspendSnapshot,
  store: StoreProvider,
): Promise<void> {
  await store.write(`${SUSPEND_PREFIX}${checkpointId}`, snapshot);
}

export async function loadSuspend(
  checkpointId: string,
  store: StoreProvider,
): Promise<SuspendSnapshot | null> {
  return store.read<SuspendSnapshot>(`${SUSPEND_PREFIX}${checkpointId}`);
}

export async function removeSuspend(
  checkpointId: string,
  store: StoreProvider,
): Promise<void> {
  await store.remove(`${SUSPEND_PREFIX}${checkpointId}`);
}
