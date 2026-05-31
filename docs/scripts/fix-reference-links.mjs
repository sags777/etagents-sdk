import { readdir, readFile, writeFile } from "node:fs/promises";

const referenceRoot = new URL("../content/reference/", import.meta.url);
const propertyAnchorPattern = /\(([^)]+\.md)#property-[^)]+\)/g;

async function walk(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) {
      files.push(...(await walk(childUrl)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(childUrl);
    }
  }

  return files;
}

async function main() {
  const files = await walk(referenceRoot);
  let touchedFiles = 0;
  let replacedLinks = 0;

  for (const fileUrl of files) {
    const source = await readFile(fileUrl, "utf8");
    let fileReplacements = 0;
    const next = source.replace(propertyAnchorPattern, (_match, target) => {
      fileReplacements += 1;
      return `(${target})`;
    });

    if (fileReplacements === 0) continue;

    await writeFile(fileUrl, next, "utf8");
    touchedFiles += 1;
    replacedLinks += fileReplacements;
  }

  if (replacedLinks > 0) {
    console.log(
      `[fix-reference-links] Updated ${replacedLinks} inherited property link${replacedLinks === 1 ? "" : "s"} across ${touchedFiles} file${touchedFiles === 1 ? "" : "s"}.`,
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[fix-reference-links] ${message}`);
  process.exitCode = 1;
});