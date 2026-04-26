import type {
  PrivacyProvider,
  PrivacyMap,
  MaskResult,
  EncryptedMap,
} from "../../../interfaces/privacy.js";
import { PrivacyError } from "../../../errors.js";
import type { PiiRule } from "../types.js";
import { BUILTIN_RULES } from "../rules/rules.js";

/**
 * Matches any placeholder produced by RegexPrivacy.
 * Format: ⟨eta:CATEGORY:xxxx⟩ where xxxx is 4 lowercase hex digits.
 */
const PLACEHOLDER_RE = /⟨eta:[A-Z_]+:[0-9a-f]{4}⟩/g;

/** Fixed application-level salt — never changes across releases. */
const HKDF_SALT = encodeStr("eta:privacy:v1");

// ---------------------------------------------------------------------------
// RegexPrivacy
// ---------------------------------------------------------------------------

/**
 * RegexPrivacy — regex-based PII masking with AES-256-GCM map encryption.
 *
 * Placeholder format: `⟨eta:CATEGORY:xxxx⟩`
 *   — xxxx is a zero-padded hex counter, unique per replacement within this instance.
 *
 * Encryption uses AES-256-GCM via Web Crypto (globalThis.crypto.subtle) with
 * an HKDF-SHA256 derived key.  When no passphrase is provided, encryptMap and
 * decryptMap operate as identity functions (base64 encoding only).
 *
 * @param rules     Override built-in rules. Defaults to BUILTIN_RULES.
 * @param passphrase Optional encryption passphrase for map at-rest protection.
 */
export class RegexPrivacy implements PrivacyProvider {
  private readonly rules: PiiRule[];
  /** original value → placeholder (for determinism across repeated calls) */
  private readonly seenValues = new Map<string, string>();
  private counter = 0;
  private readonly passphrase?: string;

  constructor(rules?: PiiRule[], passphrase?: string) {
    this.rules = rules ?? BUILTIN_RULES;
    this.passphrase = passphrase;
  }

  // -------------------------------------------------------------------------
  // PrivacyProvider
  // -------------------------------------------------------------------------

  async mask(text: string): Promise<MaskResult> {
    type MatchRecord = {
      start: number;
      end: number;
      value: string;
      category: string;
    };

    // Collect all non-overlapping matches across all rules
    const allMatches: MatchRecord[] = [];

    for (const rule of this.rules) {
      // Clone the regex so exec() state is per-call
      const re = new RegExp(rule.pattern.source, ensureGlobal(rule.pattern.flags));
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        allMatches.push({
          start: m.index,
          end: m.index + m[0].length,
          value: m[0],
          category: rule.category,
        });
      }
    }

    // Sort by start offset; discard overlapping spans (first span wins)
    allMatches.sort((a, b) => a.start - b.start);
    const resolved: MatchRecord[] = [];
    let cursor = 0;
    for (const match of allMatches) {
      if (match.start >= cursor) {
        resolved.push(match);
        cursor = match.end;
      }
    }

    // Replace right-to-left so earlier indices stay valid
    const newEntries: PrivacyMap = new Map();
    let result = text;
    for (let i = resolved.length - 1; i >= 0; i--) {
      const { start, end, value, category } = resolved[i];
      let placeholder = this.seenValues.get(value);
      if (placeholder === undefined) {
        placeholder = `⟨eta:${category.toUpperCase()}:${(this.counter++).toString(16).padStart(4, "0")}⟩`;
        this.seenValues.set(value, placeholder);
        newEntries.set(placeholder, value);
      }
      result = result.slice(0, start) + placeholder + result.slice(end);
    }

    return { masked: result, map: newEntries };
  }

  async unmask(text: string, map: PrivacyMap): Promise<string> {
    return text.replace(PLACEHOLDER_RE, (p) => map.get(p) ?? p);
  }

  async encryptMap(map: PrivacyMap): Promise<EncryptedMap> {
    const payload = JSON.stringify(Array.from(map.entries()));
    if (!this.passphrase) {
      return { iv: "", ciphertext: Buffer.from(payload, "utf-8").toString("base64") };
    }
    try {
      const key = await this.deriveKey(this.passphrase);
      const iv = new Uint8Array(new ArrayBuffer(12));
      globalThis.crypto.getRandomValues(iv);
      const cipherBuf = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encodeStr(payload),
      );
      return {
        iv: bufToHex(iv),
        ciphertext: bufToHex(new Uint8Array(cipherBuf)),
      };
    } catch (err) {
      throw new PrivacyError(`encryptMap failed: ${String(err)}`);
    }
  }

  async decryptMap(encrypted: EncryptedMap): Promise<PrivacyMap> {
    if (!this.passphrase || encrypted.iv === "") {
      const entries = JSON.parse(
        Buffer.from(encrypted.ciphertext, "base64").toString("utf-8"),
      ) as [string, string][];
      return new Map(entries);
    }
    try {
      const key = await this.deriveKey(this.passphrase);
      const iv = hexToBuf(encrypted.iv);
      const data = hexToBuf(encrypted.ciphertext);
      const plain = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        data,
      );
      const entries = JSON.parse(new TextDecoder().decode(plain)) as [string, string][];
      return new Map(entries);
    } catch (err) {
      throw new PrivacyError(`decryptMap failed: ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async deriveKey(passphrase: string): Promise<CryptoKey> {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      "raw",
      encodeStr(passphrase),
      { name: "HKDF" },
      false,
      ["deriveKey"],
    );
    return globalThis.crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: HKDF_SALT,
        info: new Uint8Array(new ArrayBuffer(0)),
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (not exported)
// ---------------------------------------------------------------------------

function ensureGlobal(flags: string): string {
  return flags.includes("g") ? flags : flags + "g";
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encode a UTF-8 string to a Uint8Array backed by a plain ArrayBuffer.
 * Required for Web Crypto API compatibility in TypeScript 5.4+ where
 * TextEncoder.encode() returns Uint8Array<ArrayBufferLike>.
 */
function encodeStr(str: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(str);
  const ab = new ArrayBuffer(src.byteLength);
  const out = new Uint8Array(ab);
  out.set(src);
  return out;
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(ab);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
