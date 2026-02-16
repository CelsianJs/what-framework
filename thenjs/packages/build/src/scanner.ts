// @thenjs/build — File system scanner for routes, API handlers, RPC, and tasks

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename, dirname } from 'node:path';
import type { RouteManifest, TaskManifest } from './build.js';

const PAGE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];
const LAYOUT_NAMES = ['_layout', '_Layout'];
const ERROR_NAMES = ['_error', '_Error'];
const LOADING_NAMES = ['_loading', '_Loading'];
const IGNORED_PREFIXES = ['_', '.'];

// ─── Page Scanner ───

export interface ScannedPage {
  /** Route path (e.g., '/', '/about', '/users/:id') */
  path: string;
  /** Absolute file path */
  file: string;
  /** Relative file path from root */
  relative: string;
  /** Rendering mode */
  mode: 'client' | 'server' | 'static' | 'hybrid';
  /** Layout file (if one exists in the directory or ancestors) */
  layout?: string;
  /** Is this a layout file itself? */
  isLayout: boolean;
  /** Is this an error page? */
  isError: boolean;
  /** Is this a loading page? */
  isLoading: boolean;
}

/**
 * Scan src/pages/ directory for page components.
 * Convention:
 *   src/pages/index.tsx     → /
 *   src/pages/about.tsx     → /about
 *   src/pages/users/[id].tsx → /users/:id
 *   src/pages/blog/[...slug].tsx → /blog/*slug
 *   src/pages/_layout.tsx   → layout wrapper
 *   src/pages/_error.tsx    → error boundary
 */
export async function scanPages(root: string, options?: { defaultMode?: ScannedPage['mode'] }): Promise<ScannedPage[]> {
  const defaultMode = options?.defaultMode ?? 'hybrid';
  const pagesDir = join(root, 'src', 'pages');
  const pages: ScannedPage[] = [];

  if (!await exists(pagesDir)) return pages;

  await walkDir(pagesDir, async (filePath) => {
    const ext = extname(filePath);
    if (!PAGE_EXTENSIONS.includes(ext)) return;

    const name = basename(filePath, ext);
    const relPath = relative(pagesDir, filePath);
    const relFromRoot = relative(root, filePath);

    // Check if it's a special file
    const isLayout = LAYOUT_NAMES.includes(name);
    const isError = ERROR_NAMES.includes(name);
    const isLoading = LOADING_NAMES.includes(name);

    // Convert file path to route path
    const routePath = fileToRoutePath(relPath, ext);

    // Extract page mode from the file's `export const page = { mode: '...' }`
    const mode = await extractPageMode(filePath, defaultMode);

    // Find the nearest layout
    const layout = await findNearestLayout(dirname(filePath), pagesDir);

    pages.push({
      path: routePath,
      file: filePath,
      relative: relFromRoot,
      mode,
      layout: layout ? relative(root, layout) : undefined,
      isLayout,
      isError,
      isLoading,
    });
  });

  return pages;
}

// ─── API Scanner ───

export interface ScannedAPI {
  /** API route path (e.g., '/api/health', '/api/users/:id') */
  path: string;
  /** Absolute file path */
  file: string;
  /** Relative file path from root */
  relative: string;
  /** HTTP methods exported (GET, POST, etc.) */
  methods: string[];
}

/**
 * Scan src/api/ directory for API route handlers.
 * Convention:
 *   src/api/health.ts → /api/health
 *   src/api/users/[id].ts → /api/users/:id
 *
 * Each file exports named handlers: GET, POST, PUT, PATCH, DELETE, or default
 */
export async function scanAPI(root: string): Promise<ScannedAPI[]> {
  const apiDir = join(root, 'src', 'api');
  const routes: ScannedAPI[] = [];

  if (!await exists(apiDir)) return routes;

  await walkDir(apiDir, async (filePath) => {
    const ext = extname(filePath);
    if (!['.ts', '.js'].includes(ext)) return;

    const name = basename(filePath, ext);
    if (IGNORED_PREFIXES.some(p => name.startsWith(p))) return;

    const relPath = relative(apiDir, filePath);
    const relFromRoot = relative(root, filePath);
    const routePath = '/api' + fileToRoutePath(relPath, ext);

    // Extract exported method handlers
    const methods = await extractExportedMethods(filePath);

    routes.push({
      path: routePath,
      file: filePath,
      relative: relFromRoot,
      methods,
    });
  });

  return routes;
}

// ─── RPC Scanner ───

export interface ScannedRPC {
  /** Module path (e.g., 'src/rpc/index.ts') */
  file: string;
  /** Whether it has a default export (the router) */
  hasDefaultExport: boolean;
}

/**
 * Scan for RPC router at src/rpc/index.ts
 */
export async function scanRPC(root: string): Promise<ScannedRPC | null> {
  const candidates = [
    join(root, 'src', 'rpc', 'index.ts'),
    join(root, 'src', 'rpc', 'index.js'),
    join(root, 'src', 'rpc.ts'),
    join(root, 'src', 'rpc.js'),
  ];

  for (const file of candidates) {
    if (await exists(file)) {
      const content = await readFile(file, 'utf8');
      return {
        file: relative(root, file),
        hasDefaultExport: /export\s+default\b/.test(content),
      };
    }
  }

  return null;
}

// ─── Task Scanner ───

export interface ScannedTask {
  /** Task name (derived from filename) */
  name: string;
  /** Absolute file path */
  file: string;
  /** Relative file path from root */
  relative: string;
  /** Task type: cron or queue */
  type: 'cron' | 'queue';
  /** Cron schedule (if cron type) */
  schedule?: string;
  /** Queue concurrency (if queue type) */
  concurrency?: number;
}

/**
 * Scan src/tasks/ for cron jobs and queue workers.
 * Convention:
 *   src/tasks/cleanup.ts → exports { schedule: '0 * * * *', handler }
 *   src/tasks/email-queue.ts → exports { queue: true, concurrency: 5, handler }
 */
export async function scanTasks(root: string): Promise<ScannedTask[]> {
  const tasksDir = join(root, 'src', 'tasks');
  const tasks: ScannedTask[] = [];

  if (!await exists(tasksDir)) return tasks;

  await walkDir(tasksDir, async (filePath) => {
    const ext = extname(filePath);
    if (!['.ts', '.js'].includes(ext)) return;

    const name = basename(filePath, ext);
    if (IGNORED_PREFIXES.some(p => name.startsWith(p))) return;

    const relFromRoot = relative(root, filePath);
    const content = await readFile(filePath, 'utf8');

    // Check for cron schedule
    const scheduleMatch = content.match(/schedule\s*[:=]\s*['"]([^'"]+)['"]/);
    // Check for queue config
    const queueMatch = content.match(/queue\s*[:=]\s*true/);
    const concurrencyMatch = content.match(/concurrency\s*[:=]\s*(\d+)/);

    if (scheduleMatch) {
      tasks.push({
        name,
        file: filePath,
        relative: relFromRoot,
        type: 'cron',
        schedule: scheduleMatch[1],
      });
    } else if (queueMatch) {
      tasks.push({
        name,
        file: filePath,
        relative: relFromRoot,
        type: 'queue',
        concurrency: concurrencyMatch ? parseInt(concurrencyMatch[1]!, 10) : 1,
      });
    }
  });

  return tasks;
}

// ─── Build Manifest from Scanned Files ───

export async function buildRouteManifestFromScan(root: string): Promise<RouteManifest> {
  const [pages, apiRoutes, rpc] = await Promise.all([
    scanPages(root),
    scanAPI(root),
    scanRPC(root),
  ]);

  return {
    pages: pages
      .filter(p => !p.isLayout && !p.isError && !p.isLoading)
      .map(p => ({
        path: p.path,
        mode: p.mode,
        component: p.relative,
        layout: p.layout,
      })),
    api: apiRoutes.map(a => ({
      path: a.path,
      methods: a.methods,
      handler: a.relative,
    })),
    rpc: rpc ? [{ path: rpc.file, type: 'query' as const }] : [],
  };
}

export async function buildTaskManifestFromScan(root: string): Promise<TaskManifest> {
  const tasks = await scanTasks(root);

  return {
    cron: tasks
      .filter(t => t.type === 'cron')
      .map(t => ({
        name: t.name,
        schedule: t.schedule!,
        handler: t.relative,
      })),
    queue: tasks
      .filter(t => t.type === 'queue')
      .map(t => ({
        name: t.name,
        concurrency: t.concurrency ?? 1,
        handler: t.relative,
      })),
  };
}

// ─── Utility: Find client entries ───

export async function findClientEntriesFromScan(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};

  // Always include the main entry if it exists
  const mainCandidates = [
    'src/entry-client.tsx',
    'src/entry-client.ts',
    'src/entry-client.jsx',
    'src/entry-client.js',
  ];
  for (const candidate of mainCandidates) {
    if (await exists(join(root, candidate))) {
      entries.main = candidate;
      break;
    }
  }

  // Also include any page that uses client-side rendering
  const pages = await scanPages(root);
  for (const page of pages) {
    if (page.mode === 'client' && !page.isLayout && !page.isError && !page.isLoading) {
      const key = page.path.replace(/\//g, '_').replace(/^_/, '') || 'index';
      entries[`page-${key}`] = page.relative;
    }
  }

  // Fallback if nothing found
  if (Object.keys(entries).length === 0) {
    entries.main = 'src/entry-client.tsx';
  }

  return entries;
}

// ─── Helpers ───

function fileToRoutePath(relPath: string, ext: string): string {
  // Remove extension
  let route = relPath.slice(0, -ext.length);

  // Normalize separators
  route = route.replace(/\\/g, '/');

  // index → /
  if (route === 'index') return '/';
  route = route.replace(/\/index$/, '');

  // [param] → :param
  route = route.replace(/\[\.\.\.(\w+)\]/g, '*$1');
  route = route.replace(/\[(\w+)\]/g, ':$1');

  // Ensure leading slash
  if (!route.startsWith('/')) route = '/' + route;

  return route;
}

async function extractPageMode(
  filePath: string,
  defaultMode: 'client' | 'server' | 'static' | 'hybrid' = 'hybrid',
): Promise<'client' | 'server' | 'static' | 'hybrid'> {
  try {
    const content = await readFile(filePath, 'utf8');
    // Look for: export const page = { mode: 'server' }
    const match = content.match(/mode\s*:\s*['"](\w+)['"]/);
    if (match) {
      const mode = match[1] as string;
      if (['client', 'server', 'static', 'hybrid'].includes(mode)) {
        return mode as 'client' | 'server' | 'static' | 'hybrid';
      }
    }
  } catch {
    // File read failed
  }
  return defaultMode;
}

async function extractExportedMethods(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    const methods: string[] = [];

    // Match: export function GET, export const GET, export async function GET
    const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    for (const method of httpMethods) {
      const pattern = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`);
      if (pattern.test(content)) {
        methods.push(method);
      }
    }

    // Check for default export
    if (/export\s+default\b/.test(content)) {
      if (methods.length === 0) {
        methods.push('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
      }
    }

    return methods.length > 0 ? methods : ['GET'];
  } catch {
    return ['GET'];
  }
}

async function findNearestLayout(dir: string, pagesRoot: string): Promise<string | null> {
  let current = dir;

  while (current.startsWith(pagesRoot)) {
    for (const name of LAYOUT_NAMES) {
      for (const ext of PAGE_EXTENSIONS) {
        const layoutPath = join(current, `${name}${ext}`);
        if (await exists(layoutPath)) {
          return layoutPath;
        }
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkDir(dir: string, callback: (filePath: string) => Promise<void>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories
      if (entry.name.startsWith('.')) continue;
      await walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      await callback(fullPath);
    }
  }
}
