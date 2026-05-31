import { describe, expect, it } from "vitest";
import { NO_OP_MEMORY, NO_OP_PRIVACY, NO_OP_STORE } from "./index.js";

describe("no-op providers", () => {
  it("returns inert memory operations", async () => {
    await expect(
      NO_OP_MEMORY.index({
        id: "m1",
        text: "hello",
        scope: { agentId: "agent", namespace: "default" },
      }),
    ).resolves.toBeUndefined();
    await expect(NO_OP_MEMORY.search("hello")).resolves.toEqual([]);
    await expect(NO_OP_MEMORY.delete("m1")).resolves.toBeUndefined();
    await expect(
      NO_OP_MEMORY.clear({ agentId: "agent", namespace: "default" }),
    ).resolves.toBeUndefined();
  });

  it("returns inert store operations", async () => {
    await expect(NO_OP_STORE.read("missing")).resolves.toBeNull();
    await expect(NO_OP_STORE.write("k", { ok: true })).resolves.toBeUndefined();
    await expect(NO_OP_STORE.remove("k")).resolves.toBeUndefined();
    await expect(NO_OP_STORE.list("prefix")).resolves.toEqual([]);
  });

  it("round-trips privacy maps without transforming the text", async () => {
    const { masked, map } = await NO_OP_PRIVACY.mask("plain text");
    expect(masked).toBe("plain text");
    expect(map.size).toBe(0);

    await expect(NO_OP_PRIVACY.unmask(masked, map)).resolves.toBe("plain text");

    const encrypted = await NO_OP_PRIVACY.encryptMap(
      new Map<string, string>([["token", "value"]]),
    );
    await expect(NO_OP_PRIVACY.decryptMap(encrypted)).resolves.toEqual(
      new Map<string, string>([["token", "value"]]),
    );
  });
});