import { describe, it, expect } from "vitest";
import { BUILTIN_RULES } from "./rules.js";

function matchAll(text: string, rule: (typeof BUILTIN_RULES)[number]): string[] {
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  return Array.from(text.matchAll(re)).map((m) => m[0]);
}

describe("BUILTIN_RULES", () => {
  describe("email", () => {
    const rule = BUILTIN_RULES.find((r) => r.name === "email")!;

    it("matches a plain email address", () => {
      expect(matchAll("Contact us at hello@example.com please", rule)).toContain(
        "hello@example.com",
      );
    });

    it("matches email with plus addressing", () => {
      expect(matchAll("user+tag@domain.org", rule)).toContain("user+tag@domain.org");
    });

    it("does not match text without @", () => {
      expect(matchAll("notanemail.com", rule)).toHaveLength(0);
    });
  });

  describe("ssn", () => {
    const rule = BUILTIN_RULES.find((r) => r.name === "ssn")!;

    it("matches NNN-NN-NNNN format", () => {
      expect(matchAll("SSN: 123-45-6789", rule)).toContain("123-45-6789");
    });

    it("matches NNN NN NNNN (space-separated)", () => {
      expect(matchAll("SSN 123 45 6789 here", rule)).toContain("123 45 6789");
    });

    it("does not match plain 9-digit number", () => {
      expect(matchAll("123456789", rule)).toHaveLength(0);
    });
  });

  describe("creditCard", () => {
    const rule = BUILTIN_RULES.find((r) => r.name === "creditCard")!;

    it("matches 16-digit sequence", () => {
      const matches = matchAll("4111111111111111", rule);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].replace(/[\s\-]/g, "")).toMatch(/^\d{16}$/);
    });

    it("matches 16-digit sequence with spaces", () => {
      const matches = matchAll("4111 1111 1111 1111", rule);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe("phone", () => {
    const rule = BUILTIN_RULES.find((r) => r.name === "phone")!;

    it("matches US format NNN-NNN-NNNN", () => {
      expect(matchAll("Call 555-867-5309", rule)).toContain("555-867-5309");
    });

    it("matches US format with dots", () => {
      expect(matchAll("555.867.5309", rule)).toContain("555.867.5309");
    });

    it("matches international +1 prefix", () => {
      const matches = matchAll("+1-555-867-5309", rule);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe("ipAddress", () => {
    const rule = BUILTIN_RULES.find((r) => r.name === "ipAddress")!;

    it("matches a valid IPv4 address", () => {
      expect(matchAll("Server at 192.168.1.1 is down", rule)).toContain("192.168.1.1");
    });

    it("matches address with max octets (255.255.255.255)", () => {
      expect(matchAll("255.255.255.255", rule)).toContain("255.255.255.255");
    });

    it("does not match values above 255 in octets", () => {
      expect(matchAll("999.999.999.999", rule)).toHaveLength(0);
    });
  });

  describe("name", () => {
    const rule = BUILTIN_RULES.find((r) => r.name === "name")!;

    it("matches Dr. followed by a name", () => {
      expect(matchAll("Referred by Dr. Jane Smith", rule)).toContain("Dr. Jane Smith");
    });

    it("matches Mr. with single last name", () => {
      const matches = matchAll("Hello Mr. Jones", rule);
      expect(matches.length).toBeGreaterThan(0);
    });

    it("does not match lower-case names without title", () => {
      expect(matchAll("john doe", rule)).toHaveLength(0);
    });
  });

  describe("rule structure", () => {
    it("all rules have global flag on pattern", () => {
      for (const rule of BUILTIN_RULES) {
        expect(rule.pattern.flags, `rule "${rule.name}" must have 'g' flag`).toContain("g");
      }
    });

    it("all rules have non-empty name, pattern, and category", () => {
      for (const rule of BUILTIN_RULES) {
        expect(rule.name).toBeTruthy();
        expect(rule.category).toBeTruthy();
        expect(rule.pattern).toBeInstanceOf(RegExp);
      }
    });
  });
});
