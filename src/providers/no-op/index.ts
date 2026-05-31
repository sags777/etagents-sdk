/**
 * Shared no-op provider implementations.
 *
 * Used as default fallbacks in `createAgent()` and in test fixtures.
 * Import from here rather than repeating inline definitions.
 */

import type { MemoryProvider } from "../../types/contracts/memory.js";
import type { StoreProvider } from "../../types/contracts/store.js";
import type { PrivacyProvider, PrivacyMap } from "../../types/contracts/privacy.js";

export const NO_OP_MEMORY: MemoryProvider = {
  async index() {},
  async search() {
    return [];
  },
  async delete() {},
  async clear() {},
};

export const NO_OP_STORE: StoreProvider = {
  async read() {
    return null;
  },
  async write() {},
  async remove() {},
  async list() {
    return [];
  },
};

export const NO_OP_PRIVACY: PrivacyProvider = {
  async mask(text) {
    return { masked: text, map: new Map<string, string>() };
  },
  async unmask(text) {
    return text;
  },
  async encryptMap(map: PrivacyMap) {
    return { iv: "", ciphertext: JSON.stringify([...map]) };
  },
  async decryptMap(enc) {
    return new Map<string, string>(
      JSON.parse(enc.ciphertext) as [string, string][],
    );
  },
};
