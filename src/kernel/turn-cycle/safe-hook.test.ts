import { describe, expect, it, vi } from "vitest";
import { safeHook } from "./safe-hook.js";

describe("safeHook", () => {
  it("returns the hook result when the hook succeeds", async () => {
    await expect(safeHook(async () => 42)).resolves.toBe(42);
  });

  it("logs and swallows errors from the hook", async () => {
    const error = new Error("boom");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      safeHook(async () => {
        throw error;
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[eta:kernel] lifecycle hook error:",
      error,
    );
  });
});