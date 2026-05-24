/**
 * @module @etagents/sdk/kernel
 *
 * Core runtime — the SDK's IP. Not swappable by design.
 * Orchestrates turn cycles, tool routing, memory, privacy, and persistence.
 */

export { startRun } from "./entry/start.js";
export { continueRun } from "./entry/continue.js";
