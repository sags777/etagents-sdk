import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import llmsTxtPlugin from './plugins/llms-txt';
import type { PluginOptions as TypeDocPluginOptions } from 'docusaurus-plugin-typedoc';

// ─── Single source of truth for all branding ───────────────────────────────
const brand = {
  name: 'etagents',
  title: 'etagents docs',
  tagline: 'TypeScript SDK for production AI agents',
  url: 'https://docs.everythingagents.ai',
  githubUrl: 'https://github.com/sags777/etagents-sdk',
  npmPackage: '@etagents/sdk',
} as const;

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: brand.title,
  tagline: brand.tagline,
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: brand.url,
  baseUrl: '/',

  organizationName: 'sags777',
  projectName: 'etagents-sdk',

  // Never lower this — broken links must fail CI
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Search: Algolia DocSearch will be added here once approved (free for open-source).
  // Apply at https://docsearch.algolia.com/apply/ when Phase 4b content is live.
  // Config block to add:
  //   themeConfig: { algolia: { appId: '...', apiKey: '...', indexName: 'etagents-docs' } }

  plugins: [
    llmsTxtPlugin,
    [
      'docusaurus-plugin-typedoc',
      {
        entryPoints: ['../src/index.ts'],
        tsconfig: '../tsconfig.json',
        out: 'content/reference',
        readme: 'none',
        excludePrivate: true,
        excludeInternal: true,
        skipErrorChecking: true,
        exclude: ['../src/collections/**'],
        parametersFormat: 'table',
        interfacePropertiesFormat: 'table',
        typeDeclarationFormat: 'table',
        enumMembersFormat: 'table',
      } satisfies Partial<TypeDocPluginOptions>,
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          // Serve docs from root (no /docs/ prefix) — all internal links must NOT use /docs/
          routeBasePath: '/',
          path: 'content',
          sidebarPath: './sidebars.ts',
          editUrl: `${brand.githubUrl}/tree/main/docs/content/`,
        },
        // No blog — this is a docs-only site
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/og-card.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: brand.name,
      logo: {
        alt: `${brand.name} logo`,
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'mainSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: brand.githubUrl,
          label: 'GitHub',
          position: 'right',
        },
        {
          href: `https://www.npmjs.com/package/${brand.npmPackage}`,
          label: 'npm',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Quick Start',
              to: '/getting-started/quickstart',
            },
            {
              label: 'Concepts',
              to: '/getting-started/concepts',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'GitHub',
              href: brand.githubUrl,
            },
            {
              label: 'npm',
              href: `https://www.npmjs.com/package/${brand.npmPackage}`,
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} everythingagents. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
