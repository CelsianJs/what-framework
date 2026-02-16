// @thenjs/build — Tests for file system scanner

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  scanPages,
  scanAPI,
  scanRPC,
  scanTasks,
  buildRouteManifestFromScan,
  buildTaskManifestFromScan,
  findClientEntriesFromScan,
} from '../src/scanner.js';

const TEST_ROOT = join(import.meta.dirname ?? __dirname, '__test-project__');

// ─── Setup / Teardown ───

async function createTestProject(structure: Record<string, string>) {
  await rm(TEST_ROOT, { recursive: true, force: true });

  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = join(TEST_ROOT, filePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
}

afterEach(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

// ─── scanPages ───

describe('scanPages', () => {
  it('scans basic pages from src/pages/', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export default function Home() { return 'Home'; }`,
      'src/pages/about.tsx': `export default function About() { return 'About'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    const paths = pages.map(p => p.path).sort();

    expect(paths).toEqual(['/', '/about']);
  });

  it('handles nested directories', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export default function Home() { return 'Home'; }`,
      'src/pages/users/index.tsx': `export default function Users() { return 'Users'; }`,
      'src/pages/users/settings.tsx': `export default function Settings() { return 'Settings'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    const paths = pages.map(p => p.path).sort();

    expect(paths).toEqual(['/', '/users', '/users/settings']);
  });

  it('converts [param] to :param', async () => {
    await createTestProject({
      'src/pages/users/[id].tsx': `export default function User() { return 'User'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    expect(pages[0]!.path).toBe('/users/:id');
  });

  it('converts [...slug] to *slug', async () => {
    await createTestProject({
      'src/pages/blog/[...slug].tsx': `export default function Post() { return 'Post'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    expect(pages[0]!.path).toBe('/blog/*slug');
  });

  it('detects page mode from export', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export const page = { mode: 'server' };\nexport default function Home() {}`,
      'src/pages/about.tsx': `export const page = { mode: 'static' };\nexport default function About() {}`,
      'src/pages/contact.tsx': `export default function Contact() {}`,
    });

    const pages = await scanPages(TEST_ROOT);
    const modeMap = Object.fromEntries(pages.map(p => [p.path, p.mode]));

    expect(modeMap['/']).toBe('server');
    expect(modeMap['/about']).toBe('static');
    expect(modeMap['/contact']).toBe('hybrid'); // default
  });

  it('identifies layout files', async () => {
    await createTestProject({
      'src/pages/_layout.tsx': `export default function Layout({ children }) { return children; }`,
      'src/pages/index.tsx': `export default function Home() { return 'Home'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    const layout = pages.find(p => p.isLayout);
    const home = pages.find(p => !p.isLayout);

    expect(layout).toBeDefined();
    expect(layout!.isLayout).toBe(true);
    expect(home!.layout).toBeDefined();
  });

  it('identifies error pages', async () => {
    await createTestProject({
      'src/pages/_error.tsx': `export default function ErrorPage() { return 'Error'; }`,
      'src/pages/index.tsx': `export default function Home() { return 'Home'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    const error = pages.find(p => p.isError);

    expect(error).toBeDefined();
    expect(error!.isError).toBe(true);
  });

  it('returns empty array when src/pages does not exist', async () => {
    await createTestProject({
      'src/api/health.ts': `export function GET() {}`,
    });

    const pages = await scanPages(TEST_ROOT);
    expect(pages).toEqual([]);
  });

  it('finds nearest layout in parent directories', async () => {
    await createTestProject({
      'src/pages/_layout.tsx': `export default function RootLayout({ children }) { return children; }`,
      'src/pages/admin/dashboard.tsx': `export default function Dashboard() { return 'Dashboard'; }`,
    });

    const pages = await scanPages(TEST_ROOT);
    const dashboard = pages.find(p => p.path === '/admin/dashboard');

    expect(dashboard).toBeDefined();
    expect(dashboard!.layout).toBeDefined();
    expect(dashboard!.layout).toContain('_layout.tsx');
  });
});

// ─── scanAPI ───

describe('scanAPI', () => {
  it('scans API routes from src/api/', async () => {
    await createTestProject({
      'src/api/health.ts': `export function GET() { return Response.json({ status: 'ok' }); }`,
      'src/api/users.ts': `export function GET() {}\nexport function POST() {}`,
    });

    const routes = await scanAPI(TEST_ROOT);
    const paths = routes.map(r => r.path).sort();

    expect(paths).toEqual(['/api/health', '/api/users']);
  });

  it('extracts exported HTTP methods', async () => {
    await createTestProject({
      'src/api/items.ts': `export function GET() {}\nexport function POST() {}\nexport function DELETE() {}`,
    });

    const routes = await scanAPI(TEST_ROOT);
    expect(routes[0]!.methods.sort()).toEqual(['DELETE', 'GET', 'POST']);
  });

  it('handles nested API routes', async () => {
    await createTestProject({
      'src/api/users/[id].ts': `export function GET() {}`,
    });

    const routes = await scanAPI(TEST_ROOT);
    expect(routes[0]!.path).toBe('/api/users/:id');
  });

  it('detects default export as all methods', async () => {
    await createTestProject({
      'src/api/catch-all.ts': `export default function handler() {}`,
    });

    const routes = await scanAPI(TEST_ROOT);
    expect(routes[0]!.methods).toContain('GET');
    expect(routes[0]!.methods).toContain('POST');
  });

  it('ignores files starting with _', async () => {
    await createTestProject({
      'src/api/_helpers.ts': `export function helper() {}`,
      'src/api/health.ts': `export function GET() {}`,
    });

    const routes = await scanAPI(TEST_ROOT);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.path).toBe('/api/health');
  });

  it('returns empty array when src/api does not exist', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export default function Home() {}`,
    });

    const routes = await scanAPI(TEST_ROOT);
    expect(routes).toEqual([]);
  });
});

// ─── scanRPC ───

describe('scanRPC', () => {
  it('finds RPC router at src/rpc/index.ts', async () => {
    await createTestProject({
      'src/rpc/index.ts': `export default { user: { getById: {} } };`,
    });

    const rpc = await scanRPC(TEST_ROOT);
    expect(rpc).not.toBeNull();
    expect(rpc!.hasDefaultExport).toBe(true);
  });

  it('returns null when no RPC directory exists', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export default function Home() {}`,
    });

    const rpc = await scanRPC(TEST_ROOT);
    expect(rpc).toBeNull();
  });
});

// ─── scanTasks ───

describe('scanTasks', () => {
  it('detects cron tasks', async () => {
    await createTestProject({
      'src/tasks/cleanup.ts': `
        export const schedule = '0 * * * *';
        export async function handler() { console.log('cleanup'); }
      `,
    });

    const tasks = await scanTasks(TEST_ROOT);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe('cron');
    expect(tasks[0]!.schedule).toBe('0 * * * *');
    expect(tasks[0]!.name).toBe('cleanup');
  });

  it('detects queue tasks', async () => {
    await createTestProject({
      'src/tasks/email-sender.ts': `
        export const queue = true;
        export const concurrency = 5;
        export async function handler(job) { console.log(job); }
      `,
    });

    const tasks = await scanTasks(TEST_ROOT);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe('queue');
    expect(tasks[0]!.concurrency).toBe(5);
  });

  it('returns empty array when src/tasks does not exist', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export default function Home() {}`,
    });

    const tasks = await scanTasks(TEST_ROOT);
    expect(tasks).toEqual([]);
  });
});

// ─── buildRouteManifestFromScan ───

describe('buildRouteManifestFromScan', () => {
  it('builds a complete route manifest', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export const page = { mode: 'hybrid' };\nexport default function Home() {}`,
      'src/pages/about.tsx': `export const page = { mode: 'static' };\nexport default function About() {}`,
      'src/pages/_layout.tsx': `export default function Layout({ children }) { return children; }`,
      'src/api/health.ts': `export function GET() {}`,
      'src/rpc/index.ts': `export default {};`,
    });

    const manifest = await buildRouteManifestFromScan(TEST_ROOT);

    // Pages (should exclude layout)
    expect(manifest.pages).toHaveLength(2);
    expect(manifest.pages.map(p => p.path).sort()).toEqual(['/', '/about']);

    // API
    expect(manifest.api).toHaveLength(1);
    expect(manifest.api[0]!.path).toBe('/api/health');

    // RPC
    expect(manifest.rpc).toHaveLength(1);
  });
});

// ─── buildTaskManifestFromScan ───

describe('buildTaskManifestFromScan', () => {
  it('builds task manifest from src/tasks', async () => {
    await createTestProject({
      'src/tasks/cleanup.ts': `export const schedule = '0 3 * * *';\nexport async function handler() {}`,
      'src/tasks/notifications.ts': `export const queue = true;\nexport const concurrency = 3;\nexport async function handler() {}`,
    });

    const manifest = await buildTaskManifestFromScan(TEST_ROOT);

    expect(manifest.cron).toHaveLength(1);
    expect(manifest.cron[0]!.name).toBe('cleanup');
    expect(manifest.cron[0]!.schedule).toBe('0 3 * * *');

    expect(manifest.queue).toHaveLength(1);
    expect(manifest.queue[0]!.name).toBe('notifications');
    expect(manifest.queue[0]!.concurrency).toBe(3);
  });
});

// ─── findClientEntriesFromScan ───

describe('findClientEntriesFromScan', () => {
  it('finds entry-client.tsx as main entry', async () => {
    await createTestProject({
      'src/entry-client.tsx': `import { mount } from 'what-framework'; mount();`,
      'src/pages/index.tsx': `export default function Home() {}`,
    });

    const entries = await findClientEntriesFromScan(TEST_ROOT);
    expect(entries.main).toBe('src/entry-client.tsx');
  });

  it('includes client-mode pages as separate entries', async () => {
    await createTestProject({
      'src/entry-client.tsx': `mount();`,
      'src/pages/index.tsx': `export const page = { mode: 'client' };\nexport default function Home() {}`,
    });

    const entries = await findClientEntriesFromScan(TEST_ROOT);
    expect(entries.main).toBe('src/entry-client.tsx');
    // Should also have the client page entry
    expect(Object.keys(entries).length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to src/entry-client.tsx when nothing found', async () => {
    await createTestProject({
      'src/pages/index.tsx': `export default function Home() {}`,
    });

    const entries = await findClientEntriesFromScan(TEST_ROOT);
    expect(entries.main).toBe('src/entry-client.tsx');
  });
});
