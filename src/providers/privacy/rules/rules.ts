import type { PiiRule } from "../types.js";

/**
 * BUILTIN_RULES — default PII detection patterns.
 *
 * Rules are applied in order; earlier matches take priority when spans overlap.
 * The `name` (person name) rule is intentionally last and may produce false positives
 * — pass a custom rule set to RegexPrivacy to exclude it.
 */
export const BUILTIN_RULES: PiiRule[] = [
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    category: "email",
  },
  {
    name: "ssn",
    // US Social Security Number: NNN-NN-NNNN or NNN NN NNNN
    pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
    category: "ssn",
  },
  {
    name: "creditCard",
    // 13–19 digit sequences with optional spaces or dashes
    pattern: /\b(?:\d[ \-]*){13,19}\d\b/g,
    category: "credit_card",
  },
  {
    name: "phone",
    // North American and international formats
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]\d{4}\b/g,
    category: "phone",
  },
  {
    name: "ipAddress",
    pattern:
      /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}\b/g,
    category: "ip_address",
  },
  {
    name: "name",
    // Titles followed by one or two capitalised words — configurable by passing custom rules
    pattern: /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
    category: "name",
  },
];
