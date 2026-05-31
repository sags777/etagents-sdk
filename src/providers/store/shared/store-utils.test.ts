import { describe, expect, it } from "vitest";
import { StoreError } from "../../../lib/errors.js";
import { wrapStoreError } from "./store-utils.js";

describe("wrapStoreError", () => {
  it("returns the wrapped operation result on success", async () => {
    await expect(
      wrapStoreError("read", "session/1", async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it("wraps thrown errors in a StoreError with context", async () => {
    await expect(
      wrapStoreError("write", "session/2", async () => {
        throw new Error("disk full");
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "StoreError",
        code: "STORE_ERROR",
        message: 'write("session/2") failed: Error: disk full',
      }),
    );

    await expect(
      wrapStoreError("write", "session/2", async () => {
        throw new Error("disk full");
      }),
    ).rejects.toBeInstanceOf(StoreError);
  });
});