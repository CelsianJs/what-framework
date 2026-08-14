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

/** Locates `export const page = {`. Non-global so .exec carries no lastIndex. */
const PAGE_EXPORT_RE = /export\s+const\s+page\s*=\s*\{/;

/**
 * Extract `export const page = { ... }` from a file's source code.
 *
 * This used to be four chained regexes over the matched text (swap ' for ",
 * quote bare keys, drop trailing commas, strip comments). Every one of them was
 * blind to string boundaries, so any config whose VALUES contained a
 * parser-significant character was corrupted into invalid JSON and thrown away:
 *
 *   vary: ['cookie:theme']          → the key regex rewrote it to ["cookie":theme"]
 *   canonical: 'https://x.com/a'    → the comment strip ate the rest of the line
 *   title: "What's new"             → the quote swap produced "What"s new"
 *   meta: { title: 'Docs' }         → /\{[^}]*\}/ stopped at the inner brace
 *   revalidate: 60, // seconds      → commas were collapsed BEFORE comments were
 *                                     stripped, so ",\s*}" never matched
 *
 * So we tokenize instead. A single left-to-right scan knows when it is inside a
 * string, so keys are only quoted outside strings, comments are removed before
 * anything else looks at the text, and brace matching finds the real end of the
 * literal. It is still not a JS parser: only JSON-shaped values are supported
 * (strings, numbers, booleans, null, arrays, nested objects). Anything else is
 * a parse failure, which is now REPORTED rather than swallowed.
 *
 * @param {string} source            Page module source.
 * @param {{ filePath?: string }} [options]  filePath is used in the warning.
 * @returns {{ mode: string, [key: string]: unknown }}
 */
export function extractPageConfig(source, options = {}) {
  const match = PAGE_EXPORT_RE.exec(source);

  // No `export const page = { ... }` at all. This is the common case (most pages
  // declare nothing), so it stays silent.
  if (!match) {
    return { mode: 'client' }; // Default
  }

  // Index of the `{` that opens the literal (last char of the matched prefix).
  const open = match.index + match[0].length - 1;

  try {
    return { mode: 'client', ...JSON.parse(objectLiteralToJson(source, open)) };
  } catch (err) {
    // The config was PRESENT and we could not read it. Falling back to
    // { mode: 'client' } silently is the difference between "this page declared
    // nothing" and "this page's declaration was thrown away", and the second one
    // silently drops the route out of static generation. Say so.
    warnUnparseablePageConfig(err, options.filePath);
    return { mode: 'client' };
  }
}

/**
 * Warn that a declared page config was discarded. Build-time diagnostic: it must
 * name the file, because the failure is otherwise invisible until someone
 * notices a route was never pre-rendered.
 */
function warnUnparseablePageConfig(err, filePath) {
  const where = filePath ? ` in ${filePath}` : '';
  console.warn(
    `[what] Ignoring unparseable \`export const page\` config${where}: ${err.message}\n` +
    `       This page falls back to mode 'client', so static generation will skip it.\n` +
    `       \`page\` must be a plain object literal of JSON-shaped values ` +
    `(strings, numbers, booleans, null, arrays, nested objects).`
  );
}

const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch) => /[A-Za-z0-9_$]/.test(ch);

/**
 * Convert the JS object literal starting at source[start] (which must be `{`)
 * into JSON text. Single pass, so it always knows whether it is inside a string.
 *
 * Throws a SyntaxError when the literal is unterminated or contains something
 * that cannot be resolved statically (a template interpolation, say). The caller
 * turns that into a warning.
 */
function objectLiteralToJson(source, start) {
  const out = [];
  // Index in `out` of the most recent comma emitted at "could still be trailing"
  // position, or -1. Whitespace and comments do not clear it, real tokens do,
  // which is what lets us drop `60, // seconds\n}` without a regex that cannot
  // tell a comma inside a string from a structural one.
  let lastComma = -1;
  let depth = 0;
  let i = start;

  while (i < source.length) {
    const ch = source[i];

    // --- comments: dropped before anything else can trip over them ---------
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl; // leave the newline as whitespace
      out.push(' ');
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) throw new SyntaxError('unterminated block comment');
      i = close + 2;
      out.push(' ');
      continue;
    }

    // --- strings: decoded, then re-emitted as valid JSON strings -----------
    if (ch === '"' || ch === "'" || ch === '`') {
      const str = readStringLiteral(source, i);
      out.push(JSON.stringify(str.value));
      lastComma = -1;
      i = str.end;
      continue;
    }

    // --- identifiers: bare keys get quoted, true/false/null pass through ---
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j])) j++;
      const word = source.slice(i, j);
      out.push(isKeyPosition(source, j) ? JSON.stringify(word) : word);
      lastComma = -1;
      i = j;
      continue;
    }

    // --- whitespace: copied, and deliberately does NOT clear lastComma -----
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      out.push(ch);
      i++;
      continue;
    }

    if (ch === ',') {
      out.push(',');
      lastComma = out.length - 1;
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (lastComma !== -1) out[lastComma] = ''; // trailing comma, drop it
      lastComma = -1;
      out.push(ch);
      i++;
      if (ch === '}' && --depth === 0) return out.join('');
      continue;
    }

    if (ch === '{') depth++;

    // Everything else (numbers, ':', '[', '-', ...) is copied verbatim. Junk
    // lands in the JSON text and JSON.parse reports it.
    out.push(ch);
    lastComma = -1;
    i++;
  }

  throw new SyntaxError('unterminated object literal');
}

/**
 * True when the token that ended at index `from` is followed by `:` (skipping
 * whitespace and comments), i.e. it was an object key and needs quoting. Values
 * like true / false / null are never followed by a colon, so they pass through.
 */
function isKeyPosition(source, from) {
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      if (nl === -1) return false;
      i = nl + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) return false;
      i = close + 2;
      continue;
    }
    return ch === ':';
  }
  return false;
}

/** JS escape sequences that map to a single character. */
const STRING_ESCAPES = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0',
  '\\': '\\', "'": "'", '"': '"', '`': '`', '/': '/',
};

/**
 * Read the JS string literal that starts at source[start] (a quote character)
 * and return its DECODED value plus the index just past the closing quote.
 *
 * Decoding rather than text-swapping is the whole point: `"What's new"` keeps its
 * apostrophe and `'a } b'` keeps its brace, because the caller re-encodes the
 * value with JSON.stringify instead of trusting the original bytes.
 */
function readStringLiteral(source, start) {
  const quote = source[start];
  let value = '';
  let i = start + 1;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\') {
      const next = source[i + 1];
      if (next === undefined) break; // unterminated, handled below

      // Line continuation: backslash + newline contributes nothing.
      if (next === '\n') { i += 2; continue; }
      if (next === '\r') { i += source[i + 2] === '\n' ? 3 : 2; continue; }

      if (next === 'u') {
        if (source[i + 2] === '{') {
          const close = source.indexOf('}', i + 3);
          if (close === -1) throw new SyntaxError('invalid unicode escape');
          value += String.fromCodePoint(parseInt(source.slice(i + 3, close), 16));
          i = close + 1;
          continue;
        }
        value += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      if (next === 'x') {
        value += String.fromCharCode(parseInt(source.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }

      // Known escape, or an unknown one (JS drops the backslash: \q is "q").
      value += Object.prototype.hasOwnProperty.call(STRING_ESCAPES, next)
        ? STRING_ESCAPES[next]
        : next;
      i += 2;
      continue;
    }

    if (ch === quote) return { value, end: i + 1 };

    // A template with an interpolation is not a static value, so refuse it
    // loudly instead of guessing.
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      throw new SyntaxError('template literal interpolation cannot be resolved at build time');
    }
    // Quoted strings cannot span lines; treat it as unterminated rather than
    // running off into the rest of the module.
    if (quote !== '`' && (ch === '\n' || ch === '\r')) break;

    value += ch;
    i++;
  }

  throw new SyntaxError('unterminated string literal');
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
      pageConfig = extractPageConfig(source, { filePath: page.filePath });
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
      pageConfig = extractPageConfig(source, { filePath: page.filePath });
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
