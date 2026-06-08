/**
 * File-Based Router for What Framework
 *
 * Scans a pages directory and generates route configuration.
 *
 * File conventions:
 *   src/pages/index.jsx        → /
 *   src/pages/about.jsx        → /about
 *   src/pages/blog/index.jsx   → /blog
 *   src/pages/blog/[slug].jsx  → /blog/:slug
 *   src/pages/[...path].jsx    → catch-all
 *   src/pages/_layout.jsx      → layout for that directory
 *   src/pages/(auth)/login.jsx → /login (group doesn't affect URL)
 *   src/pages/api/users.js     → API route: /api/users
 *
 * Page declarations (optional export in each page file):
 *   export const page = {
 *     mode: 'client',   // default — SPA, JS required
 *     mode: 'server',   // SSR on every request
 *     mode: 'static',   // pre-rendered at build time
 *     mode: 'hybrid',   // static HTML shell + interactive islands
 *   };
 */

import fs from 'fs';
import path from 'path';

const PAGE_EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts']);
const IGNORED_FILES = new Set(['_layout', '_error', '_loading', '_404']);

/**
 * Scan a directory recursively and return all page files.
 */
export function scanPages(pagesDir) {
  const pages = [];
  const layouts = [];
  const apiRoutes = [];

  function walk(dir, urlPrefix = '') {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Route groups: (name)/ — strip from URL
        const groupMatch = entry.name.match(/^\((.+)\)$/);
        if (groupMatch) {
          walk(fullPath, urlPrefix); // Same URL prefix
          continue;
        }

        // API directory
        if (entry.name === 'api' && urlPrefix === '') {
          walkApi(fullPath, '/api');
          continue;
        }

        walk(fullPath, urlPrefix + '/' + fileNameToSegment(entry.name));
        continue;
      }

      // Only process page extensions
      const ext = path.extname(entry.name);
      if (!PAGE_EXTENSIONS.has(ext)) continue;

      const baseName = path.basename(entry.name, ext);

      // Layout files
      if (baseName === '_layout') {
        layouts.push({
          filePath: fullPath,
          urlPrefix: urlPrefix || '/',
        });
        continue;
      }

      // Error/loading/404 boundaries (reserved names)
      if (IGNORED_FILES.has(baseName)) continue;

      // Convert file name to URL segment
      const urlSegment = fileNameToSegment(baseName);
      const routePath = baseName === 'index'
        ? (urlPrefix || '/')
        : urlPrefix + '/' + urlSegment;

      pages.push({
        filePath: fullPath,
        routePath: normalizePath(routePath),
        isDynamic: routePath.includes(':') || routePath.includes('*'),
      });
    }
  }

  function walkApi(dir, urlPrefix) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkApi(fullPath, urlPrefix + '/' + fileNameToSegment(entry.name));
        continue;
      }

      const ext = path.extname(entry.name);
      if (!PAGE_EXTENSIONS.has(ext)) continue;

      const baseName = path.basename(entry.name, ext);
      const segment = fileNameToSegment(baseName);
      const routePath = baseName === 'index'
        ? urlPrefix
        : urlPrefix + '/' + segment;

      apiRoutes.push({
        filePath: fullPath,
        routePath: normalizePath(routePath),
      });
    }
  }

  walk(pagesDir);

  // Sort: static routes first, then dynamic, then catch-all
  pages.sort((a, b) => {
    const aWeight = routeWeight(a.routePath);
    const bWeight = routeWeight(b.routePath);
    return aWeight - bWeight;
  });

  return { pages, layouts, apiRoutes };
}

/**
 * Convert a file name to a URL segment.
 *   [slug]     → :slug
 *   [...path]  → *path (catch-all)
 *   about      → about
 */
function fileNameToSegment(name) {
  // Catch-all: [...param]
  const catchAll = name.match(/^\[\.\.\.(\w+)\]$/);
  if (catchAll) return '*' + catchAll[1];

  // Dynamic: [param]
  const dynamic = name.match(/^\[(\w+)\]$/);
  if (dynamic) return ':' + dynamic[1];

  // Lowercase page names for URL consistency (About.jsx → /about)
  return name.toLowerCase();
}

/**
 * Normalize a route path.
 */
function normalizePath(p) {
  // Remove double slashes
  let result = p.replace(/\/+/g, '/');
  // Remove trailing slash (except root)
  if (result.length > 1 && result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result || '/';
}

/**
 * Route weight for sorting — static routes first.
 */
function routeWeight(path) {
  if (path.includes('*')) return 100;  // Catch-all last
  if (path.includes(':')) return 10;   // Dynamic middle
  return 0;                             // Static first
}

/**
 * Extract `export const page = { ... }` from a file's source code.
 * Uses simple regex — doesn't need a full parser for this.
 */
export function extractPageConfig(source) {
  // Match: export const page = { ... }
  // Handles single-line and simple multi-line objects
  const match = source.match(
    /export\s+const\s+page\s*=\s*(\{[^}]*\})/s
  );

  if (!match) {
    return { mode: 'client' }; // Default
  }

  try {
    // Simple evaluation of the object literal
    // Only supports string/boolean/number literals for safety
    const obj = match[1]
      .replace(/'/g, '"')
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/,\s*}/g, '}')
      .replace(/\/\/[^\n]*/g, ''); // Strip comments

    return { mode: 'client', ...JSON.parse(obj) };
  } catch {
    return { mode: 'client' };
  }
}

/**
 * Detect which named exports a page module declares. Functions (loader,
 * getStaticPaths) cannot live in `export const page` (JSON-only), so the codegen
 * imports them as live bindings instead. \b anchors avoid false positives like
 * `loaderState` or `getStaticPathsHelper`.
 */
export function detectPageExports(source) {
  return {
    hasLoader: /export\s+(?:async\s+)?(?:const|let|var|function)\s+loader\b/.test(source),
    hasGetStaticPaths: /export\s+(?:async\s+)?(?:const|let|var|function)\s+getStaticPaths\b/.test(source),
    hasPageConfig: /export\s+const\s+page\b/.test(source),
  };
}

/**
 * Generate the virtual routes module source code.
 * This is what gets imported as 'virtual:what-routes'.
 */
export function generateRoutesModule(pagesDir, rootDir) {
  const { pages, layouts, apiRoutes } = scanPages(pagesDir);

  const imports = [];
  const routeEntries = [];

  // Generate layout imports
  const layoutMap = new Map();
  layouts.forEach((layout, i) => {
    const varName = `_layout${i}`;
    const relPath = toImportPath(layout.filePath, rootDir);
    imports.push(`import ${varName} from '${relPath}';`);
    layoutMap.set(layout.urlPrefix, varName);
  });

  // Generate page imports and route entries
  pages.forEach((page, i) => {
    const varName = `_page${i}`;
    const relPath = toImportPath(page.filePath, rootDir);
    imports.push(`import ${varName} from '${relPath}';`);

    // Read file to extract page config + detect loader/getStaticPaths exports
    let pageConfig = { mode: 'client' };
    let detected = { hasLoader: false, hasGetStaticPaths: false, hasPageConfig: false };
    try {
      const source = fs.readFileSync(page.filePath, 'utf-8');
      pageConfig = extractPageConfig(source);
      detected = detectPageExports(source);
    } catch {}

    // Find matching layout (closest parent)
    const layoutVar = findLayout(page.routePath, layoutMap);

    const entry = {
      path: page.routePath,
      component: varName,
      mode: pageConfig.mode || 'client',
      layout: layoutVar || null,
      hasLoader: detected.hasLoader,
    };

    routeEntries.push(entry);
  });

  // Generate API route entries
  const apiEntries = [];
  apiRoutes.forEach((route, i) => {
    const varName = `_api${i}`;
    const relPath = toImportPath(route.filePath, rootDir);
    imports.push(`import * as ${varName} from '${relPath}';`);
    apiEntries.push({
      path: route.routePath,
      handlers: varName,
    });
  });

  // Build the module
  const lines = [
    '// Auto-generated by What Framework file router',
    '// Do not edit — changes will be overwritten',
    '',
    ...imports,
    '',
    'export const routes = [',
    ...routeEntries.map(r =>
      `  { path: '${r.path}', component: ${r.component}, mode: '${r.mode}'${r.layout ? `, layout: ${r.layout}` : ''}${r.hasLoader ? ', hasLoader: true' : ''} },`
    ),
    '];',
    '',
    `export const apiRoutes = [`,
    ...apiEntries.map(r =>
      `  { path: '${r.path}', handlers: ${r.handlers} },`
    ),
    '];',
    '',
    // Export page modes for the build system
    'export const pageModes = {',
    ...routeEntries.map(r =>
      `  '${r.path}': '${r.mode}',`
    ),
    '};',
  ];

  return lines.join('\n');
}

/**
 * Generate the SERVER routes module ('virtual:what-routes/server'). Same routes
 * as the client module PLUS live bindings for loader / getStaticPaths / page so
 * the deploy adapter can run them. The client module (above) deliberately omits
 * these so server loaders are never bundled into the browser.
 */
export function generateServerRoutesModule(pagesDir, rootDir) {
  const { pages, layouts, apiRoutes } = scanPages(pagesDir);

  const imports = [];
  const routeEntries = [];

  const layoutMap = new Map();
  layouts.forEach((layout, i) => {
    const varName = `_layout${i}`;
    imports.push(`import ${varName} from '${toImportPath(layout.filePath, rootDir)}';`);
    layoutMap.set(layout.urlPrefix, varName);
  });

  pages.forEach((page, i) => {
    const def = `_page${i}`;
    const ns = `_page${i}_ns`;
    const relPath = toImportPath(page.filePath, rootDir);

    let pageConfig = { mode: 'client' };
    let detected = { hasLoader: false, hasGetStaticPaths: false, hasPageConfig: false };
    try {
      const source = fs.readFileSync(page.filePath, 'utf-8');
      pageConfig = extractPageConfig(source);
      detected = detectPageExports(source);
    } catch {}

    const needsNs = detected.hasLoader || detected.hasGetStaticPaths || detected.hasPageConfig;
    if (needsNs) {
      imports.push(`import ${def}, * as ${ns} from '${relPath}';`);
    } else {
      imports.push(`import ${def} from '${relPath}';`);
    }

    routeEntries.push({
      path: page.routePath,
      component: def,
      ns,
      mode: pageConfig.mode || 'client',
      layout: findLayout(page.routePath, layoutMap) || null,
      ...detected,
    });
  });

  const apiEntries = [];
  apiRoutes.forEach((route, i) => {
    const varName = `_api${i}`;
    imports.push(`import * as ${varName} from '${toImportPath(route.filePath, rootDir)}';`);
    apiEntries.push({ path: route.routePath, handlers: varName });
  });

  const routeLine = (r) =>
    `  { path: '${r.path}', component: ${r.component}, mode: '${r.mode}'` +
    `${r.layout ? `, layout: ${r.layout}` : ''}` +
    `${r.hasLoader ? `, loader: ${r.ns}.loader` : ''}` +
    `${r.hasGetStaticPaths ? `, getStaticPaths: ${r.ns}.getStaticPaths` : ''}` +
    `${r.hasPageConfig ? `, page: ${r.ns}.page` : ''} },`;

  const lines = [
    '// Auto-generated by What Framework file router (server)',
    '// Do not edit — changes will be overwritten',
    '',
    ...imports,
    '',
    'export const routes = [',
    ...routeEntries.map(routeLine),
    '];',
    '',
    'export const apiRoutes = [',
    ...apiEntries.map(r => `  { path: '${r.path}', handlers: ${r.handlers} },`),
    '];',
    '',
    'export const pageModes = {',
    ...routeEntries.map(r => `  '${r.path}': '${r.mode}',`),
    '};',
  ];

  return lines.join('\n');
}

/**
 * Convert absolute file path to a root-relative import path.
 */
function toImportPath(filePath, rootDir) {
  const rel = path.relative(rootDir, filePath);
  // Ensure forward slashes and starts with /
  return '/' + rel.split(path.sep).join('/');
}

/**
 * Find the closest layout for a given route path.
 */
function findLayout(routePath, layoutMap) {
  // Walk up from the route path to find the nearest layout
  const segments = routePath.split('/').filter(Boolean);

  while (segments.length > 0) {
    const prefix = '/' + segments.join('/');
    if (layoutMap.has(prefix)) return layoutMap.get(prefix);
    segments.pop();
  }

  // Check root layout
  if (layoutMap.has('/')) return layoutMap.get('/');
  return null;
}
