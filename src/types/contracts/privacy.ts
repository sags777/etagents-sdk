/**
 * PrivacyProvider — contract for PII masking and map encryption.
 *
 * Contract rules (implementors must satisfy all):
 *   - `mask()` must be deterministic within a session: the same input value
 *     always produces the same placeholder token during a single process
 *     lifetime. Cross-session stability is not required.
 *   - `mask()` is additive: it returns only NEW placeholder→original entries
 *     discovered in this call. The kernel owns the cumulative map and merges
 *     successive results itself.
 *   - The provider must NEVER store, log, or persist the PrivacyMap. It is
 *     owned exclusively by the kernel and passed in only when needed.
 *   - If encryption is not needed: implement `encryptMap` and `decryptMap`
 *     as identity functions (return the input unchanged as a serialised form).
 */
export interface PrivacyProvider {
  /**
   * Scan `text` for sensitive values and replace them with placeholders.
   * Returns the masked string plus only the NEW map entries found.
   */
  mask(text: string): Promise<MaskResult>;

  /**
   * Restore original values in `text` using the provided map.
   * Placeholders not present in `map` are left as-is.
   */
  unmask(text: string, map: PrivacyMap): Promise<string>;

  /**
   * Encrypt a PrivacyMap for at-rest storage.
   * Implementors that do not need encryption return an identity form.
   */
  encryptMap(map: PrivacyMap): Promise<EncryptedMap>;

  /**
   * Decrypt an EncryptedMap back to a PrivacyMap.
   * Must be the inverse of `encryptMap`.
   */
  decryptMap(encrypted: EncryptedMap): Promise<PrivacyMap>;
}

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Maps placeholder token → original sensitive value.
 * Owned by the kernel; providers receive it as input, never store it.
 */
export type PrivacyMap = Map<string, string>;

export interface MaskResult {
  /** The input text with sensitive values replaced by placeholder tokens */
  masked: string;
  /**
   * Only the NEW placeholder→original entries found in this call.
   * The kernel merges these into its cumulative PrivacyMap.
   */
  map: PrivacyMap;
}

export interface EncryptedMap {
  /** Initialisation vector (base-64) */
  iv: string;
  /** Encrypted payload (base-64) */
  ciphertext: string;
}
