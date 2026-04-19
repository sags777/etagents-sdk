import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  mainSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/index',
        'getting-started/quickstart',
        'getting-started/concepts',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Essentials',
          collapsed: false,
          items: [
            'guides/essentials/streaming',
            'guides/essentials/persistence',
            'guides/essentials/token-budget',
            'guides/essentials/cancellation',
          ],
        },
        {
          type: 'category',
          label: 'Session Internals',
          collapsed: true,
          items: [
            'guides/session-internals/lifecycle-hooks',
            'guides/session-internals/event-stream',
            'guides/session-internals/privacy',
          ],
        },
        {
          type: 'category',
          label: 'Advanced',
          collapsed: true,
          items: [
            'guides/advanced/multi-agent',
            'guides/advanced/hitl',
            'guides/advanced/insight',
            'guides/advanced/scanner',
            'guides/advanced/concurrency',
            'guides/advanced/error-handling',
          ],
        },
        'guides/testing',
      ],
    },
    {
      type: 'doc',
      id: 'cli',
      label: 'CLI Reference',
    },
  ],
};

export default sidebars;
