// The React package matrix: every fixture in test/fixtures/matrix/src/libs,
// built for production with Vite and driven in headless Chromium, in up to
// four ways:
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
// The same spec (spec.mjs next to the fixture) drives every way.
//
//   node packages/react-compat/test/matrix-browser.mjs
//     --mode=react,compat,mixed   which builds to run (mixed runs the mixed and native variants)
//     --only=zustand,mui          which fixtures
//     --json=out.json             write the full results
//     --md                        print REACT-COMPAT.md table rows
//     --retries=1                 rerun a failed spec before calling it failed
//     --keep                      keep the dist folders
//     --timeout=15000             per-wait timeout, ms (the machine may be slow)
//     --base=<dir>                what-core and what-compiler from another checkout
//     --what-react=<dir>          what-react from another checkout (its packages/react-compat)
//
// Exit code 0 when real React passes everything and every what-react result
// matches the spec: a pass, or a failure the spec lists under `known`. A
// known failure that passes is reported too (exit 1), so the table gets
// updated. Dependencies: npm install in test/fixtures/matrix.
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
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

if (!fs.existsSync(path.join(fixture, 'node_modules/react/package.json'))) {
  console.log('SKIP: the matrix fixture is not installed (npm install in packages/react-compat/test/fixtures/matrix)');
  process.exit(0);
}

// --base=<dir>: take what-core and what-compiler from another checkout (an
// export of a commit), when the working tree's are mid-edit. what-react always
// comes from this tree.
const base = arg('base', null) ? path.resolve(String(arg('base'))) : repo;
// --what-react=<dir>: run another checkout's what-react (packages/react-compat
// of a release, to compare).
const liveCompat = path.join(repo, 'packages/react-compat');
const compatDir = arg('what-react', null) ? path.resolve(String(arg('what-react'))) : liveCompat;
const { build } = await import(require.resolve('vite'));
const what = (await import(path.join(base, 'packages/compiler/src/vite-plugin.js'))).default;
const { reactCompat: reactCompatPlugin } = await import(path.join(compatDir, 'src/vite-plugin.js'));
// The plugin aliases `react` to the what-react the fixture resolves (this
// tree's); for another checkout's, point its aliases there.
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
  return plugins;
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
const core = path.join(base, 'packages/core/src');
// The workspace's what-core, from source (dist/ may be stale in a checkout).
const coreAlias = [
  { find: /^what-(framework|core)\/render$/, replacement: path.join(core, 'render.js') },
  { find: /^what-core\/internal$/, replacement: path.join(core, 'entries/internal.js') },
  { find: /^what-(framework|core)$/, replacement: path.join(core, 'index.js') },
];

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

function configFor(mode) {
  const outDir = path.join(fixture, 'dist', mode);
  const plugins = mode === 'react' ? [matrixPlugin(mode)]
    : mode === 'compat' ? [reactCompat(), matrixPlugin(mode)]
      : [matrixPlugin(mode), what({ prodBundles: false }), reactCompat()];
  return {
    configFile: false, root: fixture, base: '/', logLevel: 'error',
    plugins,
    resolve: { alias: mode === 'react' ? [] : coreAlias },
    build: {
      outDir, emptyOutDir: true, minify: false, modulePreload: false, chunkSizeWarningLimit: 1e6,
      rollupOptions: { input: path.join(fixture, mode === 'mixed' ? 'mixed.html' : 'index.html') },
    },
  };
}

function serve(dir, html) {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      // A tiny JSON endpoint for the data-fetching fixtures.
      const n = Number(url.searchParams.get('n') || 0);
      res.setHeader('content-type', 'application/json');
      setTimeout(() => res.end(JSON.stringify({ path: url.pathname, n, items: [`item-${n}-a`, `item-${n}-b`] })), 30);
      return;
    }
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

function toolbox(page, variant, checks) {
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
    page, variant, sleep, until,
    /** A named step: its failure is the fixture's failure, and ends the run. */
    async step(name, fn) {
      try { await fn(); checks.push({ name, ok: true }); } catch (e) {
        checks.push({ name, ok: false, error: String(e && e.message || e).split('\n').slice(0, 4).join(' | ').slice(0, 500) });
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

async function runSpec(browser, baseUrl, name, variant) {
  const spec = specs[name];
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  const checks = [];
  const t = toolbox(page, variant, checks);
  const started = Date.now();
  try {
    await t.step('the fixture loads and mounts', async () => {
      await page.goto(`${baseUrl}/?lib=${encodeURIComponent(name)}&variant=${variant}`);
      await t.until(() => page.evaluate(() => window.ready === true ? 'ready' : (window.loadError || null)), (v) => v !== null, 'the page should mount', TIMEOUT * 2);
      const state = await page.evaluate(() => window.loadError || null);
      if (state) throw new Error(`the fixture did not load: ${state.slice(0, 300)}`);
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
  return { ok: failed.length === 0, checks, failed, consoleErrors: [...new Set(consoleErrors)].slice(0, 8), ms: Date.now() - started };
}

// ---- run ----
const results = {};
for (const name of names) {
  results[name] = { packages: Object.fromEntries(specs[name].packages.map((p) => [p, versionOf(p)])), exercised: specs[name].exercised, known: specs[name].known || {}, runs: {} };
}
const buildErrors = {};
const browser = await chromium.launch({ headless: !arg('headed', false) });
try {
  for (const mode of modes) {
    const config = configFor(mode);
    const t0 = Date.now();
    try {
      await build(config);
    } catch (e) {
      buildErrors[mode] = String(e && e.message || e).slice(0, 2000);
      console.log(`BUILD FAILED (${mode}):\n${buildErrors[mode]}\n`);
      continue;
    }
    console.log(`built ${mode} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const server = await serve(config.build.outDir, mode === 'mixed' ? 'mixed.html' : 'index.html');
    try {
      for (const name of names) {
        const variants = mode === 'mixed' ? ['mixed', ...(specs[name].hasNative ? ['native'] : [])] : ['fixture'];
        for (const variant of variants) {
          const column = mode === 'mixed' ? variant : mode;
          let run = await runSpec(browser, server.url, name, variant);
          for (let i = 0; i < retries && !run.ok; i++) {
            const again = await runSpec(browser, server.url, name, variant);
            if (again.ok) { again.flaky = run.failed.map((c) => `${c.name}: ${c.error}`); run = again; }
          }
          results[name].runs[column] = run;
          const knownReason = results[name].known[column];
          const label = run.ok ? (knownReason ? 'PASS (listed as known failure)' : (run.flaky ? 'ok (passed on rerun)' : 'ok')) : (knownReason ? 'known' : 'FAIL');
          console.log(`${label.padEnd(6)} ${column.padEnd(7)} ${name}  ${run.ms}ms`);
          for (const c of run.failed) console.log(`         ${c.name}: ${c.error}`);
          if (!run.ok && run.consoleErrors.length > 0) console.log(`         console: ${run.consoleErrors.slice(0, 3).join(' || ')}`);
        }
      }
    } finally {
      await server.close();
      if (!arg('keep', false)) fs.rmSync(config.build.outDir, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
  if (!arg('keep', false)) fs.rmSync(path.join(fixture, 'dist'), { recursive: true, force: true });
}

// ---- report ----
const columns = ['react', 'compat', 'mixed', 'native'].filter((c) => (c === 'native' ? modes.includes('mixed') : modes.includes(c)));
const cell = (name, column) => {
  const run = results[name].runs[column];
  if (!run) return column === 'native' && !specs[name].hasNative ? '-' : 'not run';
  return run.ok ? 'pass' : 'FAIL';
};
console.log('\n' + ['fixture'.padEnd(24), ...columns.map((c) => c.padEnd(8))].join(' '));
for (const name of names) console.log([name.padEnd(24), ...columns.map((c) => cell(name, c).padEnd(8))].join(' '));
for (const column of columns) {
  const ran = names.filter((n) => results[n].runs[column]);
  console.log(`${column}: ${ran.filter((n) => results[n].runs[column].ok).length}/${ran.length} pass`);
}

if (arg('md', false)) {
  console.log('\n| Package | Version | Real React | Full compat | Mixed (React file) | Mixed (native file) | What the fixture does |');
  console.log('|---|---|---|---|---|---|---|');
  for (const name of names) {
    const r = results[name];
    const pk = Object.keys(r.packages);
    console.log(`| ${pk.join(', ')} | ${pk.map((p) => r.packages[p]).join(', ')} | ${['react', 'compat', 'mixed', 'native'].map((c) => cell(name, c)).join(' | ')} | ${r.exercised} |`);
  }
}
if (arg('json', null)) fs.writeFileSync(path.resolve(String(arg('json'))), JSON.stringify({ date: new Date().toISOString(), modes, buildErrors, results }, null, 2));

let bad = Object.keys(buildErrors).length;
for (const name of names) {
  for (const [column, run] of Object.entries(results[name].runs)) {
    const known = results[name].known[column];
    if (column === 'react' ? !run.ok : (run.ok ? Boolean(known) : !known)) bad++;
  }
}
console.log(bad === 0 ? '\nmatrix as expected' : `\n${bad} result(s) differ from what the specs expect`);
process.exit(bad === 0 ? 0 : 1);
