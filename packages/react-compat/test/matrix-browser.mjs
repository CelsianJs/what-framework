// The React package matrix: every fixture in test/fixtures/matrix/src/libs,
// built with Vite and driven in headless Chromium, in up to four ways:
//
//   react    real React 19 (the control: a fixture that fails here is a
//            fixture bug, not a what-react bug)
//   compat   reactCompat() alone: the whole app runs on what-react
//   mixed    what() + reactCompat(): a native What app mounts the fixture (a
//            React file) as a React island
//   native   what() + reactCompat(): the fixture's native.jsx, a native What
//            file that uses the package's components with plain JSX and
//            signals (only fixtures that have one)
//
// and served one of three ways (--serve):
//
//   build    a production client build, served as static files (the default)
//   dev      Vite's dev server: dependencies pre-bundled, modules served one
//            by one, as `vite` serves an app in development
//   ssr      a production server build (`vite build --ssr`) renders the
//            fixture in Node, and the production client build hydrates that
//            HTML in the browser: react-dom/server and hydrateRoot for real
//            React, what-server's renderToHydratableString and hydrate() for
//            the mixed and native ways. Full compat has no server renderer
//            (REACT-COMPAT.md), so `compat` is not run this way. A fixture
//            that cannot render on the server with real React (its package
//            needs `window`, a store reads localStorage as it loads) is
//            recorded from the control and mounts in the browser instead.
//
// The same spec (spec.mjs next to the fixture) drives every way.
//
//   node packages/react-compat/test/matrix-browser.mjs
//     --serve=build|dev|ssr       how the fixtures are served (default: build)
//     --mode=react,compat,mixed   which builds to run (mixed runs the mixed and native variants)
//     --only=zustand,mui          which fixtures
//     --json=out.json             write the full results
//     --md                        print REACT-COMPAT.md table rows
//     --retries=1                 rerun a failed spec before calling it failed; reruns are listed
//     --probe                     ssr: also type into the server's HTML before it hydrates (focus and text kept?)
//     --keep                      keep the dist folders
//     --timeout=15000             per-wait timeout, ms (the machine may be slow)
//     --base=<dir>                what-core and what-compiler from another checkout
//     --what-react=<dir>          what-react from another checkout (its packages/react-compat)
//
// Exit code 0 when real React passes everything and every what-react result
// matches the spec: a pass, or a failure the spec lists under `known`. A
// known failure that passes is reported too (exit 1), so the table gets
// updated. A spec can quarantine a step for what-react (`quarantined`: step
// name to the open defect): its failure is listed and does not fail the run.
// Dependencies: npm ci in test/fixtures/matrix.
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const fixture = path.join(here, 'fixtures/matrix');
const libsDir = path.join(fixture, 'src/libs');
const require = createRequire(path.join(repo, 'package.json'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const modes = String(arg('mode', 'react,compat,mixed')).split(',').filter(Boolean);
const only = arg('only', null) ? String(arg('only')).split(',') : null;
const retries = Number(arg('retries', 1));
const TIMEOUT = Number(arg('timeout', 15000));
const serveKind = String(arg('serve', 'build'));
if (!['build', 'dev', 'ssr'].includes(serveKind)) {
  console.log(`--serve=${serveKind}: expected build, dev or ssr`);
  process.exit(2);
}
// Full compat has no server renderer: nothing to build or hydrate.
const runModes = serveKind === 'ssr' ? modes.filter((m) => m !== 'compat') : modes;
if (serveKind === 'ssr' && modes.includes('compat')) console.log('compat: not run with --serve=ssr (full compat has no server renderer)');

if (!fs.existsSync(path.join(fixture, 'node_modules/react/package.json'))) {
  console.log('SKIP: the matrix fixture is not installed (npm ci in packages/react-compat/test/fixtures/matrix)');
  // CI installs it; a skip there would be a green job that tested nothing.
  process.exit(process.env.WHAT_REQUIRE_MATRIX === '1' ? 1 : 0);
}

// --base=<dir>: take what-core and what-compiler from another checkout (an
// export of a commit), when the working tree's are mid-edit. what-react always
// comes from this tree.
const base = arg('base', null) ? path.resolve(String(arg('base'))) : repo;
// --what-react=<dir>: run another checkout's what-react (packages/react-compat
// of a release, to compare).
const liveCompat = path.join(repo, 'packages/react-compat');
const compatDir = arg('what-react', null) ? path.resolve(String(arg('what-react'))) : liveCompat;
const { build, createServer } = await import(require.resolve('vite'));
const what = (await import(path.join(base, 'packages/compiler/src/vite-plugin.js'))).default;
const { reactCompat: reactCompatPlugin } = await import(path.join(compatDir, 'src/vite-plugin.js'));
// The plugin aliases `react` to the what-react the fixture resolves (this
// tree's); for another checkout's, point `what-react` there. An older
// plugin's aliases are file paths into this tree; the current one's are the
// package name, which the resolver below answers.
function reactCompat() {
  const plugins = reactCompatPlugin();
  if (compatDir === liveCompat) return plugins;
  const main = plugins[0];
  const config = main.config;
  main.config = function (...args) {
    const out = config.apply(this, args);
    for (const alias of out.resolve.alias) {
      if (typeof alias.replacement === 'string' && alias.replacement.startsWith(liveCompat + path.sep)) alias.replacement = path.join(compatDir, alias.replacement.slice(liveCompat.length + 1));
    }
    out.resolve.alias.push({ find: /^what-react\/mixed$/, replacement: path.join(compatDir, 'src/mixed.js') });
    return out;
  };
  const entries = { 'what-react': 'src/index.js' };
  for (const [key, target] of Object.entries(JSON.parse(fs.readFileSync(path.join(compatDir, 'package.json'), 'utf8')).exports)) {
    if (target && typeof target === 'object' && typeof target.import === 'string') entries['what-react' + key.slice(1)] = target.import;
  }
  return [{
    name: 'matrix-other-what-react',
    enforce: 'pre',
    resolveId(id) { return Object.prototype.hasOwnProperty.call(entries, id) ? path.join(compatDir, entries[id]) : null; },
  }, ...plugins];
}
const { chromium } = require('playwright');

// ---- fixtures ----
const names = fs.readdirSync(libsDir).filter((n) => fs.existsSync(path.join(libsDir, n, 'spec.mjs')) && (!only || only.includes(n))).sort();
const specs = {};
for (const name of names) {
  specs[name] = (await import(pathToFileURL(path.join(libsDir, name, 'spec.mjs')).href)).default;
  specs[name].hasNative = fs.existsSync(path.join(libsDir, name, 'native.jsx'));
}
const versionOf = (pkg) => {
  try { return JSON.parse(fs.readFileSync(path.join(fixture, 'node_modules', pkg, 'package.json'), 'utf8')).version; } catch { return '?'; }
};

// ---- builds ----
// The workspace's framework packages, from source: every import of them,
// subpaths included, goes to the file their `import` export names (dist/ may
// be stale in a checkout, and a second what-core beside the source one would
// not share its state).
function frameworkSource() {
  const dirs = { 'what-core': 'core', 'what-framework': 'what', 'what-server': 'server', 'what-router': 'router' };
  const files = {};
  for (const [name, dir] of Object.entries(dirs)) {
    const root = path.join(base, 'packages', dir);
    for (const [key, target] of Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).exports)) {
      if (target && typeof target === 'object' && typeof target.import === 'string') files[name + key.slice(1)] = path.join(root, target.import);
    }
  }
  return {
    name: 'matrix-framework-source',
    enforce: 'pre',
    resolveId(id) { return Object.prototype.hasOwnProperty.call(files, id) ? files[id] : null; },
  };
}

const variantsOf = (mode, name) => (mode === 'mixed' ? ['mixed', ...(specs[name].hasNative ? ['native'] : [])] : ['fixture']);

// `virtual:matrix`: a loader per fixture and variant, each its own chunk, so
// a package that breaks at load breaks only its own page. In a mixed build
// each fixture also gets a native host file that renders it as an island.
function matrixPlugin(mode) {
  const hostId = (name) => path.join(libsDir, name, '__host.jsx');
  return {
    name: 'matrix-fixtures',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:matrix') return '\0virtual:matrix';
      if (id.endsWith('/__host.jsx')) return id;
      return null;
    },
    load(id) {
      if (id === '\0virtual:matrix') {
        const rows = names.map((name) => {
          const file = (f) => JSON.stringify(path.join(libsDir, name, f));
          const variants = mode === 'mixed'
            ? [`mixed: () => import(${JSON.stringify(hostId(name))})`, ...(specs[name].hasNative ? [`native: () => import(${file('native.jsx')})`] : [])]
            : [`fixture: () => import(${file('fixture.jsx')})`];
          return `${JSON.stringify(name)}: { ${variants.join(', ')} }`;
        });
        return `export const libs = {\n${rows.join(',\n')}\n};\n`;
      }
      if (id.endsWith('/__host.jsx')) {
        // A native What file: the fixture's React component is an island in it.
        return "import Fixture from './fixture.jsx';\n"
          + 'export default function Host() {\n  return <div id="native-host"><Fixture /></div>;\n}\n';
      }
      return null;
    },
  };
}

const pageOf = (mode) => (mode === 'mixed' ? 'mixed.html' : 'index.html');

function pluginsFor(mode) {
  // A page the server rendered is adopted only by JSX compiled for it: the
  // compiler decides from the Vite config, and a plain client build (what
  // --serve=ssr hydrates with) has to say so.
  const compiler = () => what({ prodBundles: false, ...(serveKind === 'ssr' ? { hydratable: true } : {}) });
  return mode === 'react' ? [matrixPlugin(mode)]
    : mode === 'compat' ? [frameworkSource(), reactCompat(), matrixPlugin(mode)]
      : [frameworkSource(), matrixPlugin(mode), compiler(), reactCompat()];
}

function configFor(mode, outDir = path.join(fixture, 'dist', mode)) {
  return {
    configFile: false, root: fixture, base: '/', logLevel: 'error',
    plugins: pluginsFor(mode),
    build: {
      outDir, emptyOutDir: true, minify: false, modulePreload: false, chunkSizeWarningLimit: 1e6,
      rollupOptions: { input: path.join(fixture, pageOf(mode)) },
    },
  };
}

// The data-fetching fixtures' JSON endpoint.
function api(url, res) {
  if (!url.pathname.startsWith('/api/')) return false;
  const n = Number(url.searchParams.get('n') || 0);
  res.setHeader('content-type', 'application/json');
  setTimeout(() => res.end(JSON.stringify({ path: url.pathname, n, items: [`item-${n}-a`, `item-${n}-b`] })), 30);
  return true;
}

// --serve=dev: Vite's dev server on the fixture. Every fixture file is an
// entry for the dependency scan, as the files of an app are through its
// static imports, so the packages are pre-bundled once when the server
// starts. The cache starts empty: a fresh checkout, a fresh `vite`.
async function startDev(mode) {
  const cacheDir = path.join(fixture, 'node_modules', `.vite-matrix-${mode}`);
  fs.rmSync(cacheDir, { recursive: true, force: true });
  const vite = await createServer({
    configFile: false, root: fixture, base: '/', logLevel: 'error', appType: 'spa', cacheDir,
    plugins: [{
      name: 'matrix-dev-server',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://x');
          if (api(url, res)) return;
          // Every page request gets this mode's page (client-side routes included).
          if ((req.headers.accept || '').includes('text/html') && !path.extname(url.pathname)) req.url = `/${pageOf(mode)}${url.search}`;
          next();
        });
      },
    }, ...pluginsFor(mode)],
    optimizeDeps: { entries: ['index.html', 'mixed.html', 'src/libs/*/fixture.jsx', 'src/libs/*/native.jsx'] },
    server: { port: 0, host: '127.0.0.1', strictPort: false },
  });
  await vite.listen();
  return {
    url: `http://127.0.0.1:${vite.httpServer.address().port}`,
    close: async () => { await vite.close(); fs.rmSync(cacheDir, { recursive: true, force: true }); },
  };
}

// --serve=ssr: the production client build (its entry hydrates), a
// production server build of the entry that renders a fixture to HTML, and
// matrix-ssr-server.mjs serving both.
async function startSsr(mode) {
  const dist = path.join(fixture, 'dist', `ssr-${mode}`);
  const ssrPlugin = {
    name: 'matrix-ssr-entries',
    enforce: 'pre',
    resolveId(id) { return id === 'virtual:matrix-server' ? '\0virtual:matrix-server.js' : null; },
    load(id) {
      if (id !== '\0virtual:matrix-server.js') return null;
      return mode === 'react'
        ? "import { createElement } from 'react';\nimport { renderToString } from 'react-dom/server';\nimport { libs } from 'virtual:matrix';\n"
          + 'export async function render(name, variant) {\n  const mod = await libs[name][variant]();\n  return renderToString(createElement(mod.default));\n}\n'
        : "import { h } from 'what-framework';\nimport { renderToHydratableString } from 'what-framework/server';\nimport { libs } from 'virtual:matrix';\n"
          + 'export async function render(name, variant) {\n  const mod = await libs[name][variant]();\n  return renderToHydratableString(h(mod.default));\n}\n';
    },
  };
  await build(configFor(mode, path.join(dist, 'client')));
  const server = configFor(mode, path.join(dist, 'server'));
  await build({
    ...server,
    plugins: [ssrPlugin, ...server.plugins],
    // The control bundles its packages too, so that what Node makes of a
    // package's files (CommonJS or ES modules, extensions) is not what the
    // control measures.
    ...(mode === 'react' ? { ssr: { noExternal: true } } : {}),
    build: { ...server.build, ssr: true, rollupOptions: { input: { server: 'virtual:matrix-server' } } },
  });
  const entry = fs.readdirSync(path.join(dist, 'server')).find((f) => /^server\.m?js$/.test(f));
  if (!entry) throw new Error(`the server build wrote no server entry (${fs.readdirSync(path.join(dist, 'server')).join(', ')})`);
  const child = spawn(process.execPath, [path.join(here, 'matrix-ssr-server.mjs'), path.join(dist, 'server', entry), path.join(dist, 'client'), pageOf(mode)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => { out += d; const m = /listening (\d+)/.exec(out); if (m) resolve(Number(m[1])); });
    child.on('exit', (code) => reject(new Error(`the matrix server exited (${code}): ${stderr.slice(0, 1000)}`)));
    setTimeout(() => reject(new Error(`the matrix server did not start: ${stderr.slice(0, 1000)}`)), 120000);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => { child.kill('SIGKILL'); if (!arg('keep', false)) fs.rmSync(dist, { recursive: true, force: true }); },
  };
}

function serve(dir, html) {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (api(url, res)) return;
    let file = path.join(dir, decodeURIComponent(url.pathname));
    // Client-side routes fall back to the page.
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, html);
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  })));
}

// ---- the spec's toolbox ----
class Abort extends Error {}

// `variant`: the column the spec runs in (react, compat, mixed or native).
function toolbox(page, variant, checks, quarantined = {}) {
  const sleep = (ms) => page.waitForTimeout(ms);
  // Poll `read` until `test(value)` holds; the failure names the last value.
  const until = async (read, test, describe, timeout = TIMEOUT) => {
    const end = Date.now() + timeout;
    let value;
    let error;
    for (;;) {
      error = null;
      try { value = await read(); if (test(value)) return value; } catch (e) { error = e; }
      if (Date.now() > end) break;
      await sleep(40);
    }
    throw new Error(`${describe}: got ${error ? `error ${String(error.message).split('\n')[0]}` : JSON.stringify(value)}`);
  };
  const matches = (expected) => (v) => (expected instanceof RegExp ? typeof v === 'string' && expected.test(v) : v === expected);
  const t = {
    page, variant, column: variant, sleep, until,
    /** A named step: its failure is the fixture's failure, and ends the run. */
    async step(name, fn) {
      try { await fn(); checks.push({ name, ok: true }); } catch (e) {
        const error = String(e && e.message || e).split('\n').slice(0, 4).join(' | ').slice(0, 500);
        // A step quarantined for what-react: listed, and the run goes on.
        if (quarantined[name] && variant !== 'react') { checks.push({ name, ok: true, quarantined: quarantined[name], error }); return; }
        checks.push({ name, ok: false, error });
        throw new Abort(name);
      }
    },
    /** Wait for an element's text to be (or match) `expected`. */
    text: (sel, expected) => until(() => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel), matches(expected), `text of ${sel} should be ${expected}`),
    /** Wait for a page expression (a function run in the page) to be `expected` (default: truthy). */
    eval: (fn, expected, describe, a) => until(() => page.evaluate(fn, a), expected === undefined ? Boolean : matches(expected), describe || String(fn).slice(0, 120)),
    count: (sel, expected) => until(() => page.evaluate((s) => document.querySelectorAll(s).length, sel), typeof expected === 'function' ? expected : (v) => v === expected, `count of ${sel} should be ${expected}`),
    gone: (sel) => until(() => page.evaluate((s) => document.querySelector(s) === null, sel), Boolean, `${sel} should be gone`),
    present: (sel) => until(() => page.evaluate((s) => document.querySelector(s) !== null, sel), Boolean, `${sel} should be present`),
    attr: (sel, name, expected) => until(() => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [sel, name]), matches(expected), `${name} of ${sel} should be ${expected}`),
    value: (sel, expected) => until(() => page.evaluate((s) => document.querySelector(s)?.value ?? null, sel), matches(expected), `value of ${sel} should be ${expected}`),
    style: (sel, prop, expected) => until(() => page.evaluate(([s, p]) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null; }, [sel, prop]), typeof expected === 'function' ? expected : matches(expected), `computed ${prop} of ${sel} should be ${expected}`),
    /** The focused element's id, or its text when it has none. */
    focus: (expected) => until(() => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.textContent.trim().slice(0, 40) || a.tagName) : null; }), matches(expected), `focus should be on ${expected}`),
    click: (sel, opts) => page.click(sel, { timeout: TIMEOUT, ...opts }),
    fill: (sel, v) => page.fill(sel, v, { timeout: TIMEOUT }),
    type: (sel, v) => page.locator(sel).pressSequentially(v, { timeout: TIMEOUT }),
    press: (key) => page.keyboard.press(key),
    hover: (sel) => page.hover(sel, { timeout: TIMEOUT }),
  };
  return t;
}

const SERVER_ISLAND_EMPTY = 'A React island could not render on the server';

// What the browser did to the server's HTML (matrix-ssr-server.mjs's probe).
const readHydration = (page) => page.evaluate(() => {
  const p = window.__hyd;
  if (!p) return null;
  return { serverElements: p.serverElements, kept: p.kept(), added: p.added, removed: p.removed, minElements: p.minElements, frames: p.frames, elements: p.now(), shift: Math.round(p.shift * 1000) / 1000 };
});

// --serve=ssr --probe: a user types into the first text field of the
// server's HTML before the client entry runs. After hydration: is the field
// still the same element, still focused, and does it still hold the text?
async function probeTyping(browser, baseUrl, name, variant) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  try {
    await page.goto(`${baseUrl}/?lib=${encodeURIComponent(name)}&variant=${variant}&hold=1`);
    const field = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('#main input, #main textarea')].filter((el) => {
        const type = el.getAttribute('type') || 'text';
        return ['text', 'search', 'email', 'url', 'tel'].includes(type) && !el.disabled && !el.readOnly && el.getClientRects().length > 0;
      });
      if (fields.length === 0) return null;
      window.__field = fields[0];
      fields[0].setAttribute('data-probe', '1');
      return fields[0].value;
    });
    if (field === null) return { field: false };
    await page.click('[data-probe="1"]');
    await page.keyboard.type('zq');
    await page.evaluate(() => { window.__start(); });
    await page.waitForFunction(() => window.ready === true || window.loadError, null, { timeout: TIMEOUT * 2 });
    await page.waitForTimeout(300);
    return await page.evaluate((before) => {
      const el = window.__field;
      const active = document.activeElement;
      const focused = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      return {
        field: true,
        sameElement: el.isConnected,
        focus: active === el ? 'kept' : focused ? 'on another field' : 'lost',
        text: (el.isConnected ? el.value : focused ? active.value : '') === before + 'zq' ? 'kept' : 'lost',
      };
    }, field);
  } catch (e) {
    return { field: true, error: String(e && e.message || e).split('\n')[0].slice(0, 200) };
  } finally {
    await context.close();
  }
}

async function runSpec(browser, baseUrl, name, variant, column) {
  const spec = specs[name];
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  const checks = [];
  const t = toolbox(page, column, checks, spec.quarantined || {});
  const started = Date.now();
  const url = `${baseUrl}/?lib=${encodeURIComponent(name)}&variant=${variant}`;
  const mounted = async (describe, timeout) => {
    await t.until(() => page.evaluate(() => (window.ready === true ? 'ready' : (window.loadError || null))).catch(() => null), (v) => v !== null, describe, timeout);
    const state = await page.evaluate(() => window.loadError || null);
    if (state) throw new Error(`the fixture did not load: ${state.slice(0, 300)}`);
  };
  /** @type {{ rendered: boolean, error: string | null, bytes: number, log: string[], hydration?: unknown } | null} */
  let server = null;
  try {
    await t.step('the fixture loads and mounts', async () => {
      if (serveKind === 'dev') {
        // A dependency the scan did not find is pre-bundled when the page
        // first asks for it, and Vite then reloads the page: the run starts
        // on a page that has settled.
        let loads = 0;
        const onLoad = () => { loads++; };
        page.on('load', onLoad);
        await page.goto(url);
        await mounted('the page should mount (first visit)', TIMEOUT * 4).catch(() => {});
        for (let quiet = 0, last = loads; quiet < 2;) { await t.sleep(300); if (loads === last) quiet++; else { quiet = 0; last = loads; } }
        page.off('load', onLoad);
        errors.length = 0;
        consoleErrors.length = 0;
      }
      await page.goto(url);
      await mounted('the page should mount', TIMEOUT * 2);
      if (serveKind === 'ssr') {
        server = await page.evaluate(() => window.__ssr || null);
        if (server && server.rendered) {
          // Two frames on: what hydration did has been painted.
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          server.hydration = await readHydration(page);
        }
      }
    });
    await spec.run(t);
    await t.step('no uncaught errors', async () => {
      await t.sleep(50);
      if (errors.length > 0) throw new Error(errors.slice(0, 3).join(' || '));
    });
  } catch (e) {
    if (!(e instanceof Abort)) checks.push({ name: 'spec', ok: false, error: String(e && e.stack || e).slice(0, 500) });
    // The uncaught errors usually name the cause of a failed step.
    if (errors.length > 0) checks.push({ name: 'uncaught errors', ok: false, error: errors.slice(0, 3).join(' || ') });
  } finally {
    await context.close();
  }
  const failed = checks.filter((c) => !c.ok);
  const run = { ok: failed.length === 0, checks, failed, quarantined: checks.filter((c) => c.quarantined), consoleErrors: [...new Set(consoleErrors)].slice(0, 8), ms: Date.now() - started };
  if (server !== null) {
    // An island that threw on the server is left to the browser, with a warning.
    const empty = server.log.find((line) => line.includes(SERVER_ISLAND_EMPTY));
    run.server = { ...server, island: !server.rendered ? 'threw' : empty ? 'empty' : 'rendered', reason: (server.error || (empty ? empty.slice(empty.indexOf(SERVER_ISLAND_EMPTY)) : '')).split(' | ')[0].slice(0, 300) || null };
  }
  return run;
}

// ---- run ----
const results = {};
for (const name of names) {
  results[name] = { packages: Object.fromEntries(specs[name].packages.map((p) => [p, versionOf(p)])), exercised: specs[name].exercised, known: specs[name].known || {}, runs: {} };
}
const buildErrors = {};
const reruns = [];
const timings = {};
const browser = await chromium.launch({ headless: !arg('headed', false) });
try {
  for (const mode of runModes) {
    const t0 = Date.now();
    let server;
    try {
      if (serveKind === 'dev') {
        server = await startDev(mode);
      } else if (serveKind === 'ssr') {
        server = await startSsr(mode);
      } else {
        const config = configFor(mode);
        await build(config);
        const built = await serve(config.build.outDir, pageOf(mode));
        server = { url: built.url, close: async () => { await built.close(); if (!arg('keep', false)) fs.rmSync(config.build.outDir, { recursive: true, force: true }); } };
      }
    } catch (e) {
      buildErrors[mode] = String(e && e.message || e).slice(0, 2000);
      console.log(`${serveKind === 'dev' ? 'DEV SERVER' : 'BUILD'} FAILED (${mode}):\n${buildErrors[mode]}\n`);
      continue;
    }
    const startup = (Date.now() - t0) / 1000;
    console.log(`${serveKind === 'dev' ? 'dev server up' : 'built'} (${mode}) in ${startup.toFixed(1)}s`);
    try {
      for (const name of names) {
        for (const variant of variantsOf(mode, name)) {
          const column = mode === 'mixed' ? variant : mode;
          let run = await runSpec(browser, server.url, name, variant, column);
          for (let i = 0; i < retries && !run.ok; i++) {
            const again = await runSpec(browser, server.url, name, variant, column);
            if (again.ok) {
              again.flaky = run.failed.map((c) => `${c.name}: ${c.error}`);
              reruns.push({ fixture: name, column, first: again.flaky });
              run = again;
            }
          }
          if (serveKind === 'ssr' && arg('probe', false) && run.server && run.server.rendered) run.typing = await probeTyping(browser, server.url, name, variant);
          // The server-build run is about the server's HTML: an island left
          // empty where real React rendered the fixture is a failure, also
          // when the browser then rendered it and every step passed.
          const control = results[name].runs.react;
          if (serveKind === 'ssr' && column !== 'react' && run.server && run.server.island !== 'rendered' && control && control.server && control.server.island === 'rendered') {
            const check = { name: 'the server renders what real React renders', ok: false, error: `the server left the island ${run.server.island === 'threw' ? 'out (the render threw)' : 'empty'}: ${run.server.reason}` };
            run.checks.push(check);
            run.failed.push(check);
            run.ok = false;
          }
          results[name].runs[column] = run;
          const knownReason = results[name].known[serveKind === 'build' ? column : `${serveKind}:${column}`] ?? results[name].known[column];
          const label = run.ok ? (knownReason ? 'PASS (listed as known failure)' : (run.flaky ? 'ok (passed on rerun)' : 'ok')) : (knownReason ? 'known' : 'FAIL');
          const note = run.server && column === 'react' && run.server.island !== 'rendered' ? `  (real React does not render it on the server: ${run.server.reason})` : '';
          console.log(`${label.padEnd(6)} ${column.padEnd(7)} ${name}  ${run.ms}ms${note}`);
          for (const c of run.failed) console.log(`         ${c.name}: ${c.error}`);
          for (const c of run.quarantined) console.log(`         quarantined step failed: ${c.name}: ${c.error}`);
          if (!run.ok && run.consoleErrors.length > 0) console.log(`         console: ${run.consoleErrors.slice(0, 3).join(' || ')}`);
        }
      }
    } finally {
      await server.close();
      timings[mode] = { startup, total: (Date.now() - t0) / 1000 };
    }
  }
} finally {
  await browser.close();
  if (!arg('keep', false)) fs.rmSync(path.join(fixture, 'dist'), { recursive: true, force: true });
}

// ---- report ----
const known = (name, column) => results[name].known[serveKind === 'build' ? column : `${serveKind}:${column}`] ?? results[name].known[column];
const columns = ['react', 'compat', 'mixed', 'native'].filter((c) => (c === 'native' ? runModes.includes('mixed') : runModes.includes(c)));
const cell = (name, column) => {
  const run = results[name].runs[column];
  if (!run) return column === 'native' && !specs[name].hasNative ? '-' : 'not run';
  return run.ok ? 'pass' : 'FAIL';
};
console.log(`\n--serve=${serveKind}`);
console.log(['fixture'.padEnd(24), ...columns.map((c) => c.padEnd(8))].join(' '));
for (const name of names) console.log([name.padEnd(24), ...columns.map((c) => cell(name, c).padEnd(8))].join(' '));
for (const column of columns) {
  const ran = names.filter((n) => results[n].runs[column]);
  console.log(`${column}: ${ran.filter((n) => results[n].runs[column].ok).length}/${ran.length} pass`);
}
for (const [mode, t] of Object.entries(timings)) console.log(`${mode}: ${t.total.toFixed(0)}s (${t.startup.toFixed(0)}s to build or start)`);

if (serveKind === 'ssr') {
  // What each way rendered on the server, and what hydration did with it.
  console.log('\nserver render and hydration (elements the server wrote / still in the page after hydration / fewest any frame saw)');
  for (const name of names) {
    const parts = [];
    for (const column of columns) {
      const run = results[name].runs[column];
      if (!run || !run.server) continue;
      const h = run.server.hydration;
      const typing = run.typing && run.typing.field ? ` typed-before-hydration: focus ${run.typing.focus ?? '?'}, text ${run.typing.text ?? '?'}` : '';
      parts.push(`${column}: ${run.server.island}${h ? ` ${h.serverElements}/${h.kept}/${h.minElements}${h.shift ? ` shift ${h.shift}` : ''}` : ''}${typing}`);
    }
    console.log(`${name.padEnd(24)} ${parts.join(' | ')}`);
  }
  const control = names.filter((n) => results[n].runs.react && results[n].runs.react.server && results[n].runs.react.server.island !== 'rendered');
  if (control.length > 0) {
    console.log('\nnot rendered on the server by real React (recorded, not a failure):');
    for (const n of control) console.log(`  ${n}: ${results[n].runs.react.server.reason}`);
  }
}

if (reruns.length > 0) {
  console.log(`\n${reruns.length} result(s) passed only on a rerun:`);
  for (const r of reruns) console.log(`  ${r.column} ${r.fixture}: ${r.first.join(' || ').slice(0, 300)}`);
} else {
  console.log('\nno reruns');
}
const quarantinedFailures = [];
for (const name of names) for (const [column, run] of Object.entries(results[name].runs)) for (const c of run.quarantined || []) quarantinedFailures.push(`${column} ${name}: ${c.name} (${c.quarantined})`);
if (quarantinedFailures.length > 0) console.log(`\nquarantined step(s) that failed:\n  ${quarantinedFailures.join('\n  ')}`);

if (arg('md', false)) {
  console.log('\n| Package | Version | Real React | Full compat | Mixed (React file) | Mixed (native file) | What the fixture does |');
  console.log('|---|---|---|---|---|---|---|');
  for (const name of names) {
    const r = results[name];
    const pk = Object.keys(r.packages);
    console.log(`| ${pk.join(', ')} | ${pk.map((p) => r.packages[p]).join(', ')} | ${['react', 'compat', 'mixed', 'native'].map((c) => cell(name, c)).join(' | ')} | ${r.exercised} |`);
  }
}
if (arg('json', null)) fs.writeFileSync(path.resolve(String(arg('json'))), JSON.stringify({ date: new Date().toISOString(), serve: serveKind, modes: runModes, buildErrors, timings, reruns, quarantined: quarantinedFailures, results }, null, 2));

let bad = Object.keys(buildErrors).length;
const unexpected = [];
for (const name of names) {
  for (const [column, run] of Object.entries(results[name].runs)) {
    const reason = known(name, column);
    if (column === 'react' ? !run.ok : (run.ok ? Boolean(reason) : !reason)) {
      bad++;
      unexpected.push(`${column} ${name}: ${run.ok ? 'passed, and its spec lists it as a known failure' : run.failed.map((c) => `${c.name}: ${c.error}`).join(' || ').slice(0, 400)}`);
    }
  }
}

// In CI: the same report on the job's summary page, reruns and quarantined
// failures included, so a flaky fixture is seen while the job is still green.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [`### React package matrix, \`--serve=${serveKind}\``, '', '| Column | Passed | Ran |', '|---|---|---|'];
  for (const column of columns) {
    const ran = names.filter((n) => results[n].runs[column]);
    lines.push(`| ${column} | ${ran.filter((n) => results[n].runs[column].ok).length} | ${ran.length} |`);
  }
  const list = (title, items) => { if (items.length > 0) lines.push('', `**${title}**`, '', ...items.map((item) => `- ${item.replace(/\|/g, '\\|')}`)); };
  list('Build or server failures', Object.entries(buildErrors).map(([mode, error]) => `${mode}: ${error.split('\n')[0]}`));
  list('Results that differ from what the specs expect', unexpected);
  list('Passed only on a rerun', reruns.map((r) => `${r.column} ${r.fixture}: ${r.first.join(' || ').slice(0, 300)}`));
  list('Quarantined steps that failed (not counted)', quarantinedFailures);
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`); } catch { /* the summary is a convenience */ }
}
console.log(bad === 0 ? '\nmatrix as expected' : `\n${bad} result(s) differ from what the specs expect`);
process.exit(bad === 0 ? 0 : 1);
