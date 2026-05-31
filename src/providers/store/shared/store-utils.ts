import { StoreError } from "../../../lib/errors.js";

/**
 * Wrap a store operation in a uniform try/catch that converts any thrown error
 * into a {@link StoreError} with operation and key context.
 *
 * Use this for store methods where the only error handling needed is catching
 * all errors and re-wrapping them. Do NOT use it when ENOENT or similar
 * provider-specific codes must be inspected before throwing.
 */
export async function wrapStoreError<T>(
  op: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new StoreError(`${op}("${key}") failed: ${String(err)}`);
  }
}
