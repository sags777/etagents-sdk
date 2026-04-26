/**
 * @module cli/commands/mask
 *
 * `eta mask [text]` — Test privacy rules against sample text. Pipe-friendly.
 */

import type { Command } from "commander";
import { BUILTIN_RULES, createPrivacy, type PiiRule } from "../../providers/privacy/index.js";

export function register(program: Command): void {
  program
    .command("mask [text]")
    .description("Mask PII in text using built-in or custom regex rules. Pipe-friendly.")
    .option(
      "--rules <list>",
      "Comma-separated rule names: email,ssn,creditCard,phone,ipAddress,name",
      (v: string) => v.split(",").map((s) => s.trim()),
    )
    .option("--pattern <regex>", 'Custom regex pattern, e.g. "/ACCT-\\d{8}/g"')
    .option("--passphrase <key>", "Encrypt the privacy map with AES-256-GCM")
    .option("--json", "Output masked text + map as JSON")
    .action(async (
      text: string | undefined,
      opts: { rules?: string[]; pattern?: string; passphrase?: string; json?: boolean },
    ) => {
      // Read from stdin if no text argument provided
      let input = text;
      if (!input || input === "-") {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        input = Buffer.concat(chunks).toString("utf-8").trimEnd();
      }

      if (!input) {
        console.error('Error: No input. Provide text as an argument or pipe via stdin.');
        process.exit(1);
      }

      const enabledNames = opts.rules && opts.rules.length > 0
        ? opts.rules
        : BUILTIN_RULES.map((rule) => rule.name);

      const selectedCategories = BUILTIN_RULES.reduce<Record<string, boolean>>((acc, rule) => {
        acc[rule.name] = enabledNames.includes(rule.name);
        return acc;
      }, {});

      if (opts.rules && !enabledNames.some((name) => BUILTIN_RULES.some((rule) => rule.name === name))) {
        const valid = BUILTIN_RULES.map((r) => r.name).join(", ");
        console.error(`Error: No matching rules. Valid rule names: ${valid}`);
        process.exit(1);
      }

      // Add custom pattern
      const extraRules: PiiRule[] = [];
      if (opts.pattern) {
        const match = opts.pattern.match(/^\/(.+)\/([gimsuy]*)$/);
        const re = match ? new RegExp(match[1], match[2] || "g") : new RegExp(opts.pattern, "g");
        extraRules.push({ name: "custom", category: "custom", pattern: re });
      }

      const privacy = createPrivacy(selectedCategories, {
        passphrase: opts.passphrase,
        extraRules,
      });
      const result = await privacy.mask(input);

      if (opts.json) {
        const mapObj = Object.fromEntries(result.map);
        const out: Record<string, unknown> = { maskedText: result.masked, map: mapObj };
        if (opts.passphrase) {
          const enc = await privacy.encryptMap(result.map);
          out.encryptedMap = enc;
        }
        console.log(JSON.stringify(out, null, 2));
        return;
      }

      console.log(result.masked);
    });
}
