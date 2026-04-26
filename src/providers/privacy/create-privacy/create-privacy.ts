import { RegexPrivacy } from "../regex-privacy/regex-privacy.js";
import type { PiiRule } from "../types.js";
import { BUILTIN_RULES } from "../rules/rules.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The names of built-in PII rule categories, matching the `name` field in
 * `BUILTIN_RULES`. Use these as keys in the `categories` map passed to
 * `createPrivacy()`.
 */
export type BuiltInCategory =
  | "email"
  | "ssn"
  | "creditCard"
  | "phone"
  | "ipAddress"
  | "name";

export interface CreatePrivacyOptions {
  /** Passphrase for AES-256-GCM encryption of the privacy map at rest. */
  passphrase?: string;
  /** Additional custom rules appended after the selected built-in rules. */
  extraRules?: PiiRule[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createPrivacy — shorthand factory for `RegexPrivacy` using category flags.
 *
 * Mirrors the declarative config style from agentgrid-sdk:
 * `{ email: true, creditCard: true }` selects exactly those built-in rules
 * without requiring callers to filter `BUILTIN_RULES` manually.
 *
 * When `categories` is empty or all values are `false`, only `extraRules`
 * (if provided) are used.
 *
 * @example
 * // Enable email + credit-card masking, encrypted map at rest
 * const privacy = createPrivacy(
 *   { email: true, creditCard: true },
 *   { passphrase: process.env.PRIVACY_KEY }
 * );
 *
 * @example
 * // All built-in rules — pass every category as true
 * const privacy = createPrivacy({ email: true, ssn: true, creditCard: true, phone: true, ipAddress: true, name: true });
 */
export function createPrivacy(
  categories: Partial<Record<BuiltInCategory, boolean>>,
  options: CreatePrivacyOptions = {},
): RegexPrivacy {
  const enabled = new Set<string>(
    (Object.entries(categories) as [BuiltInCategory, boolean][])
      .filter(([, on]) => on)
      .map(([name]) => name),
  );

  const selected = BUILTIN_RULES.filter((rule) => enabled.has(rule.name));
  const rules = options.extraRules ? [...selected, ...options.extraRules] : selected;

  return new RegexPrivacy(rules, options.passphrase);
}
