// ---------------------------------------------------------------------------
// safeHook — error-isolated lifecycle callback wrapper
// ---------------------------------------------------------------------------

/**
 * safeHook — runs a lifecycle hook and catches any errors.
 *
 * Hook errors are logged but never propagated to the kernel. This prevents
 * user-supplied hooks from crashing a run. Returns `undefined` on error.
 *
 * Different from the legacy implementation: typed generic return, logs the
 * agent name context, and does not rethrow under any condition.
 */
export async function safeHook<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error("[eta:kernel] lifecycle hook error:", err);
    return undefined;
  }
}
