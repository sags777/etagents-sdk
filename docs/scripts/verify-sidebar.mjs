#!/usr/bin/env node
/**
 * Verify every doc ID in sidebars.ts has a corresponding .mdx or .md file.
 * Exits non-zero if any ID is missing — used in CI.
 */

import {readFileSync, existsSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'content');

// Flatten all doc IDs from sidebars.ts by scanning only `id:` fields and
// standalone string items in arrays. This avoids misreading category labels.
const sidebarContent = readFileSync(join(__dirname, '..', 'sidebars.ts'), 'utf-8');
const ids = [];

for (const line of sidebarContent.split('\n')) {
  const fieldMatch = line.match(/\bid:\s*'([\w/-]+)'/);
  if (fieldMatch) {
    ids.push(fieldMatch[1]);
    continue;
  }

  const itemMatch = line.match(/^\s*'([\w/-]+)',?\s*$/);
  if (itemMatch) {
    ids.push(itemMatch[1]);
  }
}

let failed = false;
for (const id of ids) {
  const mdx = join(docsDir, `${id}.mdx`);
  const md = join(docsDir, `${id}.md`);
  const indexMdx = join(docsDir, id, 'index.mdx');
  if (!existsSync(mdx) && !existsSync(md) && !existsSync(indexMdx)) {
    console.error(`MISSING: docs/${id}.mdx (or .md)`);
    failed = true;
  }
}

if (failed) {
  console.error('\nSidebar verification failed — add the missing files above.');
  process.exit(1);
} else {
  console.log(`✓ All ${ids.length} sidebar IDs resolve to files.`);
}
