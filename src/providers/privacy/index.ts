/**
 * @module @etagents/sdk/providers/privacy
 *
 * Built-in PrivacyProvider implementations. RegexPrivacy masks PII using configurable rules.
 */

export { RegexPrivacy } from "./regex-privacy/regex-privacy.js";
export { BUILTIN_RULES, type PiiRule } from "./rules/rules.js";
