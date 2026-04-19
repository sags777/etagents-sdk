/**
 * @module cli/help
 *
 * Custom help renderer for the `eta` CLI.
 */

import type { Help } from "commander";

/**
 * Configure the Commander Help instance to widen the output column.
 * Called on `program.createHelp()` before parsing.
 */
export function configureHelp(help: Help): void {
  help.helpWidth = 100;
}
