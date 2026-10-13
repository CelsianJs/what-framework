// Vura adapter. A What app deploys to Vura as static files plus ONE
// scale-to-zero Function: the CDN serves dist/static/**, and a catch-all
// serverless route ('/*') runs the same Web-Fetch core handler every other
// adapter uses, so pages (SSR + ISR), server actions, CSRF and the revalidate
// webhook behave exactly as they do under `node server.js`.
//
// createVuraHandler wraps the handler in the Function module shape the Vura
// runtime loads (`export default { fetch(request, env) }`). buildVuraOutput
// writes the deploy directory: dist/static/**, the bundled Function at
// dist/functions/_/index.js, and dist/manifest.json (Vura manifest v1, the
// shape @celsian/vura-contract validates).

import { createRequestHandler } from './core.js';

// Vura manifest v1 constants. They mirror @celsian/vura-contract, which is a
// test-time dependency only: what-server must not pull a deploy target's
// package into every app's runtime.
const SCHEMA_VERSION = 1;
const FUNCTION_PATTERN = '/*';
const FUNCTION_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const FUNCTION_MEMORY = ['1gb', '4gb', '6gb', '8gb', '12gb'];

// A hostname with an optional port, or a bracketed IPv6 literal. Anything else
// (userinfo, a path, whitespace) means the header was not set by the edge, so
// the request keeps its own URL rather than adopting an origin we can't parse.
const FORWARDED_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function firstValue(header) {
  return header ? header.split(',')[0].trim() : '';
}

/**
 * The URL the visitor actually requested. The Function sees an internal URL
 * (http://<internal-host>/path); the Vura edge sets x-forwarded-host to the
 * public hostname and x-forwarded-proto to https. Rebuilding the URL from them
 * means absolute URLs, Secure cookies and origin checks see the public origin.
 *
 * Trust note: this believes x-forwarded-host because on Vura the edge sets it.
 * Do not put this handler behind a proxy that forwards a client-supplied
 * X-Forwarded-Host unchanged.
 *
 * @param {Request} request
 * @returns {Request}
 */
function toPublicRequest(request) {
  const host = firstValue(request.headers.get('x-forwarded-host'));
  if (!host || !FORWARDED_HOST.test(host)) return request;
  const proto = (firstValue(request.headers.get('x-forwarded-proto')) || 'https').toLowerCase();
  if (proto !== 'https' && proto !== 'http') return request;

  const internal = new URL(request.url);
  const publicUrl = `${proto}://${host}${internal.pathname}${internal.search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  /** @type {RequestInit & { duplex?: 'half' }} */
  const init = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
    signal: request.signal,
  };
  if (hasBody) {
    init.body = request.body;
    // Node's fetch refuses a streamed body without it.
    init.duplex = 'half';
  }
  return new Request(publicUrl, init);
}

/**
 * Vura Function entry: `export default createVuraHandler(...)`.
 *
 * Accepts either createRequestHandler options (`{ routes, cache, ... }`) or an
 * existing Web-Fetch handler `(request) => Response`, so an app that already
 * builds its handler (the create-what full-stack server.js does) reuses it
 * as-is instead of wiring SSR and ISR a second time.
 *
 * `env` is the runtime's frozen copy of process.env. It is exposed to loaders
 * and renderers as `request.__env`, the same place the Cloudflare adapter puts
 * its bindings.
 *
 * @param {object | ((request: Request) => Response | Promise<Response>)} [optionsOrHandler]
 * @returns {{ fetch(request: Request, env?: Record<string, string | undefined>): Promise<Response> }}
 */
export function createVuraHandler(optionsOrHandler = {}) {
  const handle = typeof optionsOrHandler === 'function'
    ? optionsOrHandler
    : createRequestHandler(optionsOrHandler);
  return {
    async fetch(request, env) {
      const publicRequest = toPublicRequest(request);
      // @ts-ignore -- adapter-private field, same convention as cloudflare.js
      if (env) publicRequest.__env = env;
      return handle(publicRequest);
    },
  };
}

/** The Function's module directory name, derived the way the platform derives it. */
function moduleNameFor(urlPattern) {
  return urlPattern.replace(/[/:*]/g, '_').replace(/^_/, '');
}

function fail(message) {
  return new Error(`[what-server] buildVuraOutput: ${message}`);
}

/**
 * Resolve a project-relative path, refusing absolute paths and `..` segments
 * so nothing outside the project is ever read or written.
 */
function projectPath(path, projectRoot, label, { resolve, isAbsolute }) {
  if (typeof path !== 'string' || path.trim() === '') throw fail(`${label} must be a non-empty project-relative path`);
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) throw fail(`${label} "${path}" must be relative to projectRoot`);
  if (path.split(/[\\/]/).includes('..')) throw fail(`${label} "${path}" must not contain ".." segments`);
  return resolve(projectRoot, path);
}

/**
 * Normalize a static target URL path ('/', '/src/pages') into its path
 * segments under dist/static. Rejects relative paths and any segment that is,
 * or decodes to, '.' or '..', or that smuggles a separator.
 */
function urlSegments(to, label) {
  if (typeof to !== 'string' || !to.startsWith('/')) throw fail(`${label} target "${to}" must be a URL path starting with "/"`);
  const segments = to.split('/').filter(Boolean);
  for (const segment of segments) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw fail(`${label} target "${to}" is not a valid URL path`); }
    if (decoded === '.' || decoded === '..' || /[\\/\0]/.test(decoded) || segment.includes('\\')) {
      throw fail(`${label} target "${to}" must not contain "." or ".." segments`);
    }
  }
  return segments;
}

/**
 * The manifest is built from constants plus two validated inputs, so this is
 * a cheap local check of the fields the platform rejects, not a second copy of
 * @celsian/vura-contract (the test suite runs the real validator).
 */
function assertManifestShape(manifest) {
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw fail('manifest schemaVersion must be 1');
  for (const route of manifest.api) {
    const segments = route.filePath.split('/');
    const hasControlChar = [...route.filePath].some((c) => c.charCodeAt(0) < 0x20);
    if (hasControlChar || segments.some((s) => s === '' || s === '.' || s === '..')) {
      throw fail(`entry path "${route.filePath}" cannot be expressed as a project-relative manifest path`);
    }
    if (!/^[A-Za-z0-9_]+$/.test(moduleNameFor(route.urlPattern))) throw fail(`invalid function module for ${route.urlPattern}`);
    if (!route.methods.every((m) => FUNCTION_METHODS.includes(m))) throw fail('invalid function methods');
    if (!FUNCTION_MEMORY.includes(route.config.compute.memory)) throw fail('invalid function memory');
  }
}

async function loadEsbuild(projectRoot) {
  const { createRequire } = await import('node:module');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  let resolved;
  try {
    resolved = createRequire(join(projectRoot, 'package.json')).resolve('esbuild');
  } catch {
    throw fail('esbuild is required to bundle the Vura Function but is not installed in this project. Run `npm i -D esbuild`.');
  }
  // A computed specifier on purpose: bundlers must not try to follow it when
  // they bundle an app that imports what-server.
  const mod = await import(pathToFileURL(resolved).href);
  return typeof mod.build === 'function' ? mod : mod.default;
}

/**
 * Write a Vura deploy directory:
 *
 *   dist/
 *     manifest.json              Vura manifest v1 (schemaVersion 1)
 *     static/**                  served by the CDN at the same URL path
 *     functions/package.json     {"type":"module"}
 *     functions/_/index.js       `entry` bundled with esbuild (one file, ESM)
 *
 * The manifest declares one catch-all serverless route ('/*', all seven HTTP
 * methods, compute class 'function'), so its requiredFeatures are exactly
 * ['api', 'function-compute']: a free-tier deploy with no dedicated compute.
 * It also sets `filesystemFirst: true`, so the edge answers requests for files
 * in dist/static before the catch-all route; everything else (pages,
 * POST /__what_action, POST /__what_revalidate) reaches the Function.
 *
 * A Function only runs while it serves a request, so the what-isr poll
 * scheduler (createScheduler) never runs inside it. Revalidate on a schedule
 * with an external cron that calls POST /__what_revalidate instead.
 *
 * The Function runs on Node 22 with no node_modules, so the bundle inlines
 * every dependency. Only Node builtins stay external. esbuild is resolved from
 * `projectRoot` (add it as a devDependency); it is never a runtime dependency.
 *
 * Options:
 *   - projectRoot  default process.cwd(). Every other path is relative to it.
 *   - outDir       default 'dist'. Must be inside projectRoot; it is deleted
 *                  and rewritten on every build.
 *   - entry        required. The Function module: its default export is
 *                  `{ fetch(request, env) }`, typically createVuraHandler(...).
 *   - staticFiles  files and directories to publish. A string 'src/pages'
 *                  is served at '/src/pages'; `{ from: 'public', to: '/' }`
 *                  maps a source to another URL path. Missing sources are
 *                  skipped and listed in the result's `skipped`.
 *   - memory       Function memory: '1gb' (default), '4gb', '6gb', '8gb', '12gb'.
 *
 * Paths are checked before anything is deleted or written: `..` segments,
 * absolute sources, and targets that would leave dist/static are refused.
 *
 * @param {{ projectRoot?: string, outDir?: string, entry: string, staticFiles?: Array<string | { from: string, to: string }>, memory?: string }} options
 */
export async function buildVuraOutput({
  projectRoot = process.cwd(),
  outDir = 'dist',
  entry,
  staticFiles = [],
  memory = '1gb',
} = /** @type {any} */ ({})) {
  const { mkdir, writeFile, cp, rm, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  const { join, resolve, relative, isAbsolute, sep } = path;

  const root = resolve(projectRoot);

  // --- Validate everything before touching the filesystem ------------------
  const outAbs = isAbsolute(outDir) ? resolve(outDir) : projectPath(outDir, root, 'outDir', path);
  const outRel = relative(root, outAbs);
  if (!outRel || outRel.startsWith('..') || isAbsolute(outRel)) {
    throw fail(`outDir "${outDir}" must be a directory inside projectRoot (it is deleted on every build)`);
  }

  const entryAbs = projectPath(entry, root, 'entry', path);
  const entryStat = await stat(entryAbs).catch(() => null);
  if (!entryStat || !entryStat.isFile()) throw fail(`entry "${entry}" does not exist (looked for ${entryAbs})`);
  if (entryAbs === outAbs || entryAbs.startsWith(outAbs + sep)) throw fail(`entry "${entry}" must not live inside outDir`);

  if (!FUNCTION_MEMORY.includes(memory)) {
    throw fail(`memory must be one of ${FUNCTION_MEMORY.join(', ')} (got "${memory}")`);
  }

  if (!Array.isArray(staticFiles)) throw fail('staticFiles must be an array');
  const staticRoot = join(outAbs, 'static');
  const copies = staticFiles.map((item) => {
    const spec = typeof item === 'string' ? { from: item, to: '/' + item.split(/[\\/]/).filter(Boolean).join('/') } : item;
    if (!spec || typeof spec !== 'object') throw fail('staticFiles entries must be a path string or { from, to }');
    const fromAbs = projectPath(spec.from, root, 'staticFiles', path);
    const dest = resolve(staticRoot, ...urlSegments(spec.to, 'staticFiles'));
    if (dest !== staticRoot && !dest.startsWith(staticRoot + sep)) throw fail(`staticFiles target "${spec.to}" escapes the static directory`);
    if (fromAbs === outAbs || fromAbs.startsWith(outAbs + sep)) throw fail(`staticFiles source "${spec.from}" must not live inside outDir`);
    return { from: spec.from, to: spec.to, fromAbs, dest };
  });

  const esbuild = await loadEsbuild(root);

  // --- Write ------------------------------------------------------------------
  await rm(outAbs, { recursive: true, force: true });
  await mkdir(staticRoot, { recursive: true });

  /** @type {Array<{ from: string, to: string }>} */
  const copied = [];
  /** @type {string[]} */
  const skipped = [];
  for (const { from, to, fromAbs, dest } of copies) {
    const info = await stat(fromAbs).catch(() => null);
    if (!info) { skipped.push(from); continue; }
    await mkdir(info.isDirectory() ? dest : path.dirname(dest), { recursive: true });
    // dereference: workspace-linked packages publish their files, not links.
    await cp(fromAbs, dest, { recursive: true, dereference: true });
    copied.push({ from, to });
  }

  const moduleName = moduleNameFor(FUNCTION_PATTERN);
  const functionsDir = join(outAbs, 'functions');
  const functionFile = join(functionsDir, moduleName, 'index.js');
  await mkdir(join(functionsDir, moduleName), { recursive: true });
  await writeFile(join(functionsDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entryAbs],
    outfile: functionFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
    // CommonJS dependencies that call require() on a builtin need a real
    // require in an ESM bundle.
    banner: { js: "import { createRequire as __whatCreateRequire } from 'node:module'; const require = __whatCreateRequire(import.meta.url);" },
  });

  const route = {
    filePath: relative(root, entryAbs).split(sep).join('/'),
    urlPattern: FUNCTION_PATTERN,
    methods: [...FUNCTION_METHODS],
    kind: 'serverless',
    hasWebsocket: false,
    config: { kind: 'serverless', compute: { class: 'function', memory } },
  };
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    // What @celsian/vura-contract's deriveRequiredFeatures returns for one
    // serverless route on function compute and no pages or layouts.
    requiredFeatures: ['api', 'function-compute'],
    api: [route],
    pages: [],
    layouts: [],
    // The platform edge serves a file from dist/static before it routes to the
    // catch-all Function only when the manifest opts in. Without it, the gated
    // edge sends /src/entry-client.js and the CSS to the Function, which 404s
    // them, and the app loses its client JS and styles.
    filesystemFirst: true,
    timestamp: new Date().toISOString(),
  };
  assertManifestShape(manifest);
  await writeFile(join(outAbs, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { outDir: outAbs, staticDir: staticRoot, functionFile, manifest, copied, skipped };
}
