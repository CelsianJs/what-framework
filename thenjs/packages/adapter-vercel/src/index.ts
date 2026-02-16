// @thenjs/adapter-vercel — Vercel Build Output API v3 adapter

import { writeFile, mkdir, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { RouteManifest, TaskManifest } from '@thenjs/build';

export interface ThenAdapter {
  name: string;
  buildEnd(options: {
    serverEntry: string;
    clientDir: string;
    staticDir: string;
    routes: RouteManifest;
    tasks: TaskManifest;
  }): Promise<void>;
  entryTemplate: string;
}

/** Vercel adapter — produces Build Output API v3 structure */
const vercelAdapter: ThenAdapter = {
  name: 'vercel',

  async buildEnd({ serverEntry, clientDir, staticDir, routes, tasks }) {
    const outputDir = '.vercel/output';

    // 1. Create directory structure
    await mkdir(join(outputDir, 'static'), { recursive: true });
    await mkdir(join(outputDir, 'functions'), { recursive: true });

    // 2. Copy client assets to static/
    try {
      await cp(clientDir, join(outputDir, 'static'), { recursive: true });
    } catch {
      console.warn('[thenjs:vercel] No client assets to copy');
    }

    // 3. Copy pre-rendered HTML to static/
    try {
      await cp(staticDir, join(outputDir, 'static'), { recursive: true });
    } catch {
      console.warn('[thenjs:vercel] No static pages to copy');
    }

    // 4. Generate serverless functions for SSR routes
    for (const page of routes.pages) {
      if (page.mode === 'server' || page.mode === 'hybrid') {
        await generateFunction(outputDir, page.path, serverEntry, 'nodejs22.x');
      }
    }

    // 5. Generate serverless functions for API routes
    for (const api of routes.api) {
      await generateFunction(outputDir, api.path, api.handler, 'nodejs22.x');
    }

    // 6. Generate serverless functions for RPC
    await generateFunction(outputDir, '_rpc', serverEntry, 'nodejs22.x');

    // 7. Generate config.json with routing rules
    const config = generateConfig(routes, tasks);
    await writeFile(
      join(outputDir, 'config.json'),
      JSON.stringify(config, null, 2),
    );

    // 8. Generate cron configuration
    if (tasks.cron.length > 0) {
      const cronConfig = {
        crons: tasks.cron.map((task) => ({
          path: `/api/_tasks/${task.name}`,
          schedule: task.schedule,
        })),
      };
      await writeFile(
        join(outputDir, 'crons.json'),
        JSON.stringify(cronConfig, null, 2),
      );
    }

    console.log('[thenjs:vercel] Build output generated');
    console.log(`  → ${outputDir}/config.json`);
    console.log(`  → ${outputDir}/static/ (CDN assets)`);
    console.log(`  → ${outputDir}/functions/ (serverless)`);
  },

  entryTemplate: 'vercel-serverless',
};

export default vercelAdapter;

// ─── Helpers ───

async function generateFunction(
  outputDir: string,
  route: string,
  handlerPath: string,
  runtime: string,
): Promise<void> {
  const funcName = route.replace(/\//g, '-').replace(/^-/, '') || 'index';
  const funcDir = join(outputDir, 'functions', `${funcName}.func`);

  await mkdir(funcDir, { recursive: true });

  // .vc-config.json
  await writeFile(
    join(funcDir, '.vc-config.json'),
    JSON.stringify({
      runtime,
      handler: 'index.mjs',
      launcherType: 'Nodejs',
    }, null, 2),
  );

  // index.mjs — serverless function entry
  const entryCode = `
import handler from '${handlerPath}';

export default async function(req, res) {
  const url = new URL(req.url, \`https://\${req.headers.host}\`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const webRequest = new Request(url.toString(), {
    method: req.method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? 'half' : undefined,
  });

  const response = await handler.handle(webRequest);

  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    res.setHeader(key, value);
  }

  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}
`;

  await writeFile(join(funcDir, 'index.mjs'), entryCode);
}

function generateConfig(
  routes: RouteManifest,
  _tasks: TaskManifest,
): Record<string, unknown> {
  const routeRules: Array<Record<string, unknown>> = [];

  // Static assets — immutable cache
  routeRules.push({
    src: '/assets/(.*)',
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });

  // SSR pages → serverless functions
  for (const page of routes.pages) {
    if (page.mode === 'server' || page.mode === 'hybrid') {
      const funcName = page.path.replace(/\//g, '-').replace(/^-/, '') || 'index';
      routeRules.push({
        src: page.path === '/' ? '^/$' : `^${page.path}$`,
        dest: `/${funcName}`,
      });
    }
  }

  // API routes → serverless functions
  for (const api of routes.api) {
    const funcName = api.path.replace(/\//g, '-').replace(/^-/, '');
    routeRules.push({
      src: `^${api.path}$`,
      dest: `/${funcName}`,
    });
  }

  // RPC → single serverless function
  routeRules.push({
    src: '^/_rpc/(.*)',
    dest: '/_rpc',
  });

  // SPA fallback for client-rendered pages
  routeRules.push({
    src: '/(.*)',
    dest: '/index.html',
  });

  return {
    version: 3,
    routes: routeRules,
  };
}
