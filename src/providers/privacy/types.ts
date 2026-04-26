/**
 * PiiRule — a single pattern used by RegexPrivacy to detect and mask sensitive data.
 */
export interface PiiRule {
  /** Human-readable rule identifier */
  name: string;
  /** Regex with global flag — must have the `g` flag set */
  pattern: RegExp;
  /** Category label embedded in the placeholder token */
  category: string;
}