/**
 * @module @etagents/sdk/providers/privacy
 *
 * Built-in PrivacyProvider implementations. RegexPrivacy masks PII using configurable rules.
 */

export { RegexPrivacy } from "./regex-privacy/regex-privacy.js";
export { BUILTIN_RULES } from "./rules/rules.js";
export type { PiiRule } from "./types.js";
export { createPrivacy } from "./create-privacy/create-privacy.js";
export type { BuiltInCategory, CreatePrivacyOptions } from "./create-privacy/create-privacy.js";
