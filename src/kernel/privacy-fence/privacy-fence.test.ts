import { describe, it, expect } from "vitest";
import { PrivacyFence } from "./privacy-fence.js";
import { RegexPrivacy } from "../../providers/privacy/regex-privacy/regex-privacy.js";
import type { Message } from "../../types/message.js";

function emailPrivacy() {
  return new RegexPrivacy([
    {
      name: "email",
      category: "email",
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    },
  ]);
}

function userMsg(content: string): Message {
  return { role: "user", content };
}

describe("PrivacyFence", () => {
  describe("no-op path (no provider)", () => {
    it("maskMessages returns input unchanged", async () => {
      const fence = PrivacyFence.create(undefined);
      const messages = [userMsg("Send to user@example.com")];
      const result = await fence.maskMessages(messages);
      expect(result).toEqual(messages);
    });

    it("unmaskText returns input unchanged", async () => {
      const fence = PrivacyFence.create(undefined);
      const result = await fence.unmaskText("⟨eta:EMAIL:abc⟩");
      expect(result).toBe("⟨eta:EMAIL:abc⟩");
    });

    it("getEncryptedMap returns null", async () => {
      const fence = PrivacyFence.create(undefined);
      expect(await fence.getEncryptedMap()).toBeNull();
    });
  });

  describe("mask before turn", () => {
    it("replaces PII in message content", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      const [masked] = await fence.maskMessages([userMsg("Email: user@example.com")]);
      expect(masked.content).not.toContain("user@example.com");
      expect(masked.content).toMatch(/⟨eta:/);
    });

    it("does not mutate the original messages array", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      const original = [userMsg("Email: user@example.com")];
      await fence.maskMessages(original);
      expect(original[0].content).toBe("Email: user@example.com");
    });

    it("processes multiple messages independently", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      const messages = [
        userMsg("a@example.com"),
        userMsg("b@example.com"),
      ];
      const masked = await fence.maskMessages(messages);
      expect(masked[0].content).toMatch(/⟨eta:/);
      expect(masked[1].content).toMatch(/⟨eta:/);
    });
  });

  describe("unmask after turn", () => {
    it("restores masked placeholder to original value", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      const [masked] = await fence.maskMessages([userMsg("Contact: alice@corp.io")]);
      const placeholder = masked.content.match(/⟨eta:[A-Z]+:[0-9a-f]+⟩/)?.[0] ?? "";
      const restored = await fence.unmaskText(`Reply to ${placeholder}`);
      expect(restored).toContain("alice@corp.io");
    });

    it("accumulates map across successive maskMessages calls", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      const [m1] = await fence.maskMessages([userMsg("a@example.com")]);
      const [m2] = await fence.maskMessages([userMsg("b@example.com")]);
      const p1 = m1.content.match(/⟨eta:[A-Z]+:[0-9a-f]+⟩/)?.[0] ?? "";
      const p2 = m2.content.match(/⟨eta:[A-Z]+:[0-9a-f]+⟩/)?.[0] ?? "";
      // Both placeholders should be resolvable via unmask
      expect(await fence.unmaskText(p1)).toContain("a@example.com");
      expect(await fence.unmaskText(p2)).toContain("b@example.com");
    });
  });

  describe("getEncryptedMap", () => {
    it("returns null when map is empty (no PII seen)", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      await fence.maskMessages([userMsg("no pii here")]);
      expect(await fence.getEncryptedMap()).toBeNull();
    });

    it("returns a non-null encrypted map after masking PII", async () => {
      const fence = PrivacyFence.create(emailPrivacy());
      await fence.maskMessages([userMsg("user@example.com")]);
      const enc = await fence.getEncryptedMap();
      expect(enc).not.toBeNull();
    });
  });
});
