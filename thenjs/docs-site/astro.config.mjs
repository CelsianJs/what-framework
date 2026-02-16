import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://thenjs.dev',
  integrations: [
    starlight({
      title: 'ThenJS',
      description: 'The meta-framework for What Framework',
      social: {
        github: 'https://github.com/zvndev/thenjs',
      },
      editLink: {
        baseUrl: 'https://github.com/zvndev/thenjs/edit/main/docs-site/',
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting Started', slug: 'guides/getting-started' },
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Deployment', slug: 'guides/deployment' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Server', slug: 'reference/server' },
            { label: 'RPC', slug: 'reference/rpc' },
            { label: 'Middleware', slug: 'reference/middleware' },
            { label: 'Real-Time (SSE & WS)', slug: 'reference/realtime' },
            { label: 'Caching & Sessions', slug: 'reference/cache' },
            { label: 'Tasks & Cron', slug: 'reference/tasks' },
            { label: 'Adapters', slug: 'reference/adapters' },
            { label: 'CLI', slug: 'reference/cli' },
          ],
        },
      ],
      customCss: [],
    }),
  ],
});
