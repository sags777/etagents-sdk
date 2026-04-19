import type { PrivacyProvider, PrivacyMap, EncryptedMap } from "../../interfaces/privacy.js";
import type { Message } from "../../types/message.js";

// ---------------------------------------------------------------------------
// PrivacyFence — owns the run-lifetime PrivacyMap
// ---------------------------------------------------------------------------

/**
 * PrivacyFence — wraps a PrivacyProvider and accumulates the PrivacyMap.
 *
 * When no provider is configured, all methods are no-ops (null object pattern)
 * so the kernel never needs `if (fence)` guards.
 *
 * The fence owns the map — merges new entries returned by each `mask()` call
 * into its cumulative store so later `unmask()` calls see all substitutions.
 */
export class PrivacyFence {
  private readonly provider: PrivacyProvider | undefined;
  private readonly map: PrivacyMap = new Map();

  private constructor(provider: PrivacyProvider | undefined) {
    this.provider = provider;
  }

  static create(provider: PrivacyProvider | undefined): PrivacyFence {
    return new PrivacyFence(provider);
  }

  /**
   * Mask PII in every message's content.
   * Returns a new array of messages with masked content; does not mutate input.
   */
  async maskMessages(messages: Message[]): Promise<Message[]> {
    if (!this.provider) return messages;
    return Promise.all(
      messages.map(async (msg) => {
        const { masked, map } = await this.provider!.mask(msg.content);
        for (const [k, v] of map) this.map.set(k, v);
        return { ...msg, content: masked };
      }),
    );
  }

  /** Restore placeholder tokens in `text` using the accumulated map. */
  async unmaskText(text: string): Promise<string> {
    if (!this.provider) return text;
    return this.provider.unmask(text, this.map);
  }

  /**
   * Encrypt the accumulated map for at-rest storage.
   * Returns `null` when there is no provider or the map is empty.
   */
  async getEncryptedMap(): Promise<EncryptedMap | null> {
    if (!this.provider || this.map.size === 0) return null;
    return this.provider.encryptMap(this.map);
  }

  /**
   * Restore a previously encrypted map into the fence's accumulator.
   * Used when resuming a suspended run.
   */
  async restoreMap(encrypted: EncryptedMap): Promise<void> {
    if (!this.provider) return;
    const restored = await this.provider.decryptMap(encrypted);
    for (const [k, v] of restored) this.map.set(k, v);
  }
}
