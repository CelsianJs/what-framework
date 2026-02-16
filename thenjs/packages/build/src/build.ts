// @thenjs/build — Production build pipeline

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ThenConfig } from '@thenjs/server';
import {
  buildRouteManifestFromScan,
  buildTaskManifestFromScan,
  findClientEntriesFromScan,
  scanPages,
} from './scanner.js';

export interface BuildOptions {
  config: ThenConfig;
  root: string;
}

export interface BuildResult {
  clientDir: string;
  serverEntry: string;
  staticDir: string;
  routes: RouteManifest;
  tasks: TaskManifest;
}

export interface RouteManifest {
  pages: Array<{
    path: string;
    mode: 'client' | 'server' | 'static' | 'hybrid';
    component: string;
    layout?: string;
  }>;
  api: Array<{
    path: string;
    methods: string[];
    handler: string;
  }>;
  rpc: Array<{
    path: string;
    type: 'query' | 'mutation';
  }>;
}

export interface TaskManifest {
  cron: Array<{
    name: string;
    schedule: string;
    handler: string;
  }>;
  queue: Array<{
    name: string;
    concurrency: number;
    handler: string;
  }>;
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const { config, root } = options;
  const outDir = config.build?.outDir ?? 'dist';

  // 1. Resolve adapter
  const adapterName = resolveAdapter(config.build?.adapter ?? 'auto');

  console.log(`[thenjs] Building for ${adapterName}...`);
  console.log(`[thenjs] Root: ${root}`);
  console.log(`[thenjs] Output: ${outDir}`);

  // 2. Scan the project
  const [routes, tasks, clientEntries] = await Promise.all([
    buildRouteManifestFromScan(root),
    buildTaskManifestFromScan(root),
    findClientEntriesFromScan(root),
  ]);

  console.log(`[thenjs] Found ${routes.pages.length} pages, ${routes.api.length} API routes`);

  // 3. Run Vite builds (client + server)
  const { build: viteBuild } = await import('vite');
  const { thenVitePlugin } = await import('./vite-plugin.js');

  // Client build
  console.log('[thenjs] Building client...');
  await viteBuild({
    root,
    plugins: thenVitePlugin({ config }),
    build: {
      outDir: `${outDir}/client`,
      manifest: true,
      rollupOptions: {
        input: clientEntries,
      },
    },
  });

  // Server build
  console.log('[thenjs] Building server...');
  await viteBuild({
    root,
    plugins: thenVitePlugin({ config }),
    build: {
      outDir: `${outDir}/server`,
      ssr: true,
      rollupOptions: {
        input: `${root}/src/entry-server.tsx`,
        output: {
          format: 'esm',
        },
      },
    },
  });

  // 4. Static pre-rendering for static pages
  console.log('[thenjs] Pre-rendering static pages...');
  await prerenderStaticPages(root, outDir, routes);

  // 5. Write route manifest to output
  await mkdir(join(outDir, 'meta'), { recursive: true });
  await writeFile(
    join(outDir, 'meta', 'routes.json'),
    JSON.stringify(routes, null, 2),
  );
  await writeFile(
    join(outDir, 'meta', 'tasks.json'),
    JSON.stringify(tasks, null, 2),
  );

  // 6. Run adapter transform
  console.log(`[thenjs] Running ${adapterName} adapter...`);
  const adapter = await loadAdapter(adapterName);
  await adapter.buildEnd({
    serverEntry: `${outDir}/server/entry-server.js`,
    clientDir: `${outDir}/client`,
    staticDir: `${outDir}/static`,
    routes,
    tasks,
  });

  console.log('[thenjs] Build complete!');

  return {
    clientDir: `${outDir}/client`,
    serverEntry: `${outDir}/server/entry-server.js`,
    staticDir: `${outDir}/static`,
    routes,
    tasks,
  };
}

// ─── Static Pre-rendering ───

async function prerenderStaticPages(
  root: string,
  outDir: string,
  routes: RouteManifest,
): Promise<string[]> {
  const staticPages = routes.pages.filter(p => p.mode === 'static');
  if (staticPages.length === 0) return [];

  const staticDir = join(outDir, 'static');
  await mkdir(staticDir, { recursive: true });

  const rendered: string[] = [];

  for (const page of staticPages) {
    try {
      // Import the server entry to render
      const serverEntry = join(root, outDir, 'server', 'entry-server.js');
      const mod = await import(serverEntry);

      if (typeof mod.render === 'function') {
        const html = await mod.render(page.path);

        // Write the HTML file
        const htmlPath = page.path === '/'
          ? join(staticDir, 'index.html')
          : join(staticDir, page.path, 'index.html');

        await mkdir(join(htmlPath, '..'), { recursive: true });
        await writeFile(htmlPath, html, 'utf8');
        rendered.push(page.path);

        console.log(`[thenjs]   Pre-rendered: ${page.path}`);
      }
    } catch (error) {
      console.warn(`[thenjs]   Failed to pre-render ${page.path}:`, (error as Error).message);
    }
  }

  return rendered;
}

// ─── Helpers ───

function resolveAdapter(adapter: string): string {
  if (adapter === 'auto') {
    return detectAdapter();
  }
  // Short aliases → full package names
  const aliases: Record<string, string> = {
    node: '@celsian/adapter-node',
    vercel: '@celsian/adapter-vercel',
    cloudflare: '@celsian/adapter-cloudflare',
    lambda: '@celsian/adapter-lambda',
    railway: '@celsian/adapter-railway',
    fly: '@celsian/adapter-fly',
  };
  return aliases[adapter] ?? adapter;
}

function detectAdapter(): string {
  if (process.env.VERCEL) return '@celsian/adapter-vercel';
  if (process.env.RAILWAY_ENVIRONMENT) return '@celsian/adapter-railway';
  if (process.env.FLY_APP_NAME) return '@celsian/adapter-fly';
  if (process.env.CF_PAGES) return '@celsian/adapter-cloudflare';
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return '@celsian/adapter-lambda';
  return '@celsian/adapter-node';
}

async function loadAdapter(name: string): Promise<{
  buildEnd(options: {
    serverEntry: string;
    clientDir: string;
    staticDir: string;
    routes: RouteManifest;
    tasks: TaskManifest;
  }): Promise<void>;
}> {
  try {
    const mod = await import(name);
    return mod.default ?? mod;
  } catch {
    console.warn(`[thenjs] Adapter "${name}" not found, using no-op adapter`);
    return {
      async buildEnd() {
        // No-op
      },
    };
  }
}
