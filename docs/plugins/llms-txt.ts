import type {LoadContext, Plugin} from '@docusaurus/types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generates /llms.txt after each build — a plain-text index of all doc pages
 * for LLM crawlers and AI-assisted discovery.
 */
function llmsTxtPlugin(_context: LoadContext): Plugin {
  return {
    name: 'llms-txt',
    async postBuild({outDir, siteConfig}) {
      const baseUrl = siteConfig.url;
      const lines: string[] = [
        `# ${siteConfig.title}`,
        `> ${siteConfig.tagline}`,
        '',
        '## Pages',
        '',
      ];

      function walk(dir: string, urlBase: string): void {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, `${urlBase}/${entry.name}`);
          } else if (entry.name === 'index.html') {
            const url = urlBase === '' ? baseUrl : `${baseUrl}${urlBase}`;
            const title = entry.name; // placeholder — TypeDoc or manual override improves this
            lines.push(`- [${urlBase || '/'}](${url})`);
          }
        }
      }

      walk(outDir, '');
      fs.writeFileSync(path.join(outDir, 'llms.txt'), lines.join('\n') + '\n', 'utf-8');
      console.log('[llms-txt] Generated llms.txt');
    },
  };
}

export default llmsTxtPlugin;
