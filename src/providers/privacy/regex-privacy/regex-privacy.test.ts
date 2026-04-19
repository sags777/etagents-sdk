import { describe, it, expect } from "vitest";
import { RegexPrivacy } from "./regex-privacy.js";

describe("RegexPrivacy", () => {
  describe("mask / unmask round-trip", () => {
    it("restores original text after mask → unmask", async () => {
      const p = new RegexPrivacy();
      const original = "Contact alice@example.com or call 555-867-5309";
      const { masked, map } = await p.mask(original);
      expect(masked).not.toBe(original);
      const restored = await p.unmask(masked, map);
      expect(restored).toBe(original);
    });

    it("handles text with no PII — returns unchanged text and empty map", async () => {
      const p = new RegexPrivacy();
      const { masked, map } = await p.mask("Hello, world!");
      expect(masked).toBe("Hello, world!");
      expect(map.size).toBe(0);
    });
  });

  describe("determinism", () => {
    it("maps the same value to the same placeholder across successive calls", async () => {
      const p = new RegexPrivacy();
      const { map: m1 } = await p.mask("Email: alice@example.com");
      const { map: m2 } = await p.mask("Again: alice@example.com");

      // First call produced a new entry; second call should not (already seen)
      expect(m1.size).toBe(1);
      expect(m2.size).toBe(0);

      // The masked text in the second call uses the same placeholder
      const placeholder = Array.from(m1.keys())[0];
      const { masked: masked2 } = await p.mask("Again: alice@example.com");
      expect(masked2).toContain(placeholder);
    });
  });

  describe("instance isolation", () => {
    it("two instances maintain independent state", async () => {
      const p1 = new RegexPrivacy();
      const p2 = new RegexPrivacy();

      const { map: m1 } = await p1.mask("alice@example.com");
      const { map: m2 } = await p2.mask("alice@example.com");

      // Both produced new entries (neither knew about the other)
      expect(m1.size).toBe(1);
      expect(m2.size).toBe(1);

      // State is not shared: masking again in p1 produces no new entries
      const { map: m1b } = await p1.mask("alice@example.com");
      expect(m1b.size).toBe(0);

      // But p2 is unaffected by p1's history beyond what p2 itself saw
      const p3 = new RegexPrivacy();
      const { map: m3 } = await p3.mask("alice@example.com");
      expect(m3.size).toBe(1);
    });
  });

  describe("encryptMap / decryptMap", () => {
    it("identity round-trip when no passphrase is set", async () => {
      const p = new RegexPrivacy();
      const { map } = await p.mask("alice@example.com, 555-123-4567");
      const encrypted = await p.encryptMap(map);
      const recovered = await p.decryptMap(encrypted);
      expect(recovered).toEqual(map);
    });

    it("AES-256-GCM round-trip with passphrase", async () => {
      const p = new RegexPrivacy(undefined, "super-secret-key");
      const { map } = await p.mask("bob@example.com");
      const encrypted = await p.encryptMap(map);

      // Ciphertext is non-empty and not plaintext
      expect(encrypted.iv).not.toBe("");
      expect(encrypted.ciphertext).not.toContain("bob@example.com");

      const recovered = await p.decryptMap(encrypted);
      expect(recovered).toEqual(map);
    });

    it("different passphrases produce different ciphertext", async () => {
      const p1 = new RegexPrivacy(undefined, "key-one");
      const p2 = new RegexPrivacy(undefined, "key-two");
      const { map } = await p1.mask("carol@example.com");

      const enc1 = await p1.encryptMap(map);
      const enc2 = await p2.encryptMap(map);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    });
  });

  describe("built-in rule coverage", () => {
    it("masks email addresses", async () => {
      const p = new RegexPrivacy();
      const { masked } = await p.mask("Reach me at test@domain.org please");
      expect(masked).not.toContain("test@domain.org");
      expect(masked).toMatch(/⟨eta:EMAIL:[0-9a-f]{4}⟩/);
    });

    it("masks US phone numbers", async () => {
      const p = new RegexPrivacy();
      const { masked } = await p.mask("Call 800-555-0199 today");
      expect(masked).not.toContain("800-555-0199");
      expect(masked).toMatch(/⟨eta:PHONE:[0-9a-f]{4}⟩/);
    });

    it("masks US SSNs", async () => {
      const p = new RegexPrivacy();
      const { masked } = await p.mask("SSN is 123-45-6789");
      expect(masked).not.toContain("123-45-6789");
      expect(masked).toMatch(/⟨eta:SSN:[0-9a-f]{4}⟩/);
    });
  });

  describe("additive map contract", () => {
    it("returns only new entries on successive calls", async () => {
      const p = new RegexPrivacy();
      const text = "alice@example.com and bob@example.com";
      const { map: first } = await p.mask(text);
      expect(first.size).toBe(2);

      // Masking the same text again should produce zero new entries
      const { map: second } = await p.mask(text);
      expect(second.size).toBe(0);

      // A new address yields exactly one new entry
      const { map: third } = await p.mask("carol@example.com");
      expect(third.size).toBe(1);
    });
  });
});
