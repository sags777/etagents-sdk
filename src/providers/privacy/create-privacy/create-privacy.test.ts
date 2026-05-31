import { describe, expect, it } from "vitest";
import { createPrivacy } from "./create-privacy.js";

describe("createPrivacy", () => {
  it("selects only the enabled built-in categories", async () => {
    const privacy = createPrivacy({ email: true, phone: true });
    const { masked } = await privacy.mask(
      "Email alice@example.com, call 555-867-5309, SSN 123-45-6789",
    );

    expect(masked).not.toContain("alice@example.com");
    expect(masked).not.toContain("555-867-5309");
    expect(masked).toContain("123-45-6789");
  });

  it("uses extra rules even when no built-in categories are enabled", async () => {
    const privacy = createPrivacy(
      {},
      {
        extraRules: [
          {
            name: "account",
            category: "ACCOUNT",
            pattern: /ACC-\d+/g,
          },
        ],
      },
    );

    const { masked } = await privacy.mask("Account ACC-123 is active");
    expect(masked).not.toContain("ACC-123");
    expect(masked).toMatch(/ACCOUNT/);
  });
});