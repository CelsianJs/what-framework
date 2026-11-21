#!/usr/bin/env node
// Hydration benchmark: the krausest page with 1,000 rows (frameworks/*/app.jsx,
// the pages the SSR benchmark renders) rendered by each framework's hydratable
// server, then hydrated in Chromium by that framework's client.
//
//   whatc   what-compiler's server target, hydrated by what-compiler's client
//           target built with `hydratable`
//   what    the h()/runtime-JSX page on both sides (vnode renderer, hydrate())
//   solid1  babel-preset-solid { generate: "ssr" | "dom", hydratable: true }
//   solid2  @solidjs/babel-plugin, the same
//
// With --before <dir>, the two What entries are also built from another What
// checkout (`before.whatc`, `before.what`), server and client: the behaviour
// to compare against.
//
// Per run, in a fresh page: the server's HTML is in the document, the client
// bundle has loaded, and the page then measures `hydrate`, the time the
// hydrate() call takes; `interactive`, from that call until a click on a row's
// label has selected the row; and `created`, the nodes in the page that were
// not there before hydrating (adopting every node the server wrote adds none).
// Reported: the median of the runs, and the client bundle's gzip size.
//
// Usage: node hydrate.mjs [--quick] [--before <what-fw checkout>]

import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildRows, SELECTED_ID } from './shared/data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(here, 'dist', 'hydrate');
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const beforeAt = args.includes('--before') ? path.resolve(args[args.indexOf('--before') + 1]) : null;
const RUNS = quick ? 5 : 21;
const ROWS = 1000;

const requireFrom = (dir) => createRequire(path.join(here, dir, 'package.json'));
const solidPresetV1 = requireFrom('frameworks/solid1')('babel-preset-solid');
const solidPluginV2 = requireFrom('frameworks/solid2')('@solidjs/babel-plugin');

async function whatCompiler(checkout) {
  return (await import(pathToFileURL(path.join(checkout, 'packages/compiler/src/babel-plugin.js')).href)).default;
}

// what-framework and its subpaths from a checkout's sources.
function whatAliases(checkout) {
  return {
    name: 'what-sources',
    setup(b) {
      b.onResolve({ filter: /^what-(framework|core|server)(\/.*)?$/ }, (resolveArgs) => {
        const [, pkg, sub = ''] = resolveArgs.path.match(/^what-(framework|core|server)(\/.*)?$/);
        const dir = path.join(checkout, 'packages', pkg === 'framework' ? 'what' : pkg);
        const pkgJson = createRequire(path.join(dir, 'package.json'))(path.join(dir, 'package.json'));
        const entry = pkgJson.exports['.' + sub];
        const target = typeof entry === 'string' ? entry : entry.import || entry.default;
        return { path: path.join(dir, target) };
      });
    },
  };
}

function babelJsx(babelOptions) {
  return {
    name: 'babel-jsx',
    setup(b) {
      b.onLoad({ filter: /\.jsx$/ }, async (loadArgs) => {
        const { readFile } = await import('node:fs/promises');
        const out = await transformAsync(await readFile(loadArgs.path, 'utf8'), {
          filename: loadArgs.path, babelrc: false, configFile: false, sourceMaps: false, ...babelOptions,
        });
        return { contents: out.code, loader: 'js' };
      });
    },
  };
}

// The server side of each entry: its hydratable renderString.
const SERVERS = {
  whatc: (checkout, compiler) => ({ dir: 'whatc', plugins: [whatAliases(checkout), babelJsx({ parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { generate: 'ssr', production: true }]] })], define: { __HYDRATABLE__: 'true' } }),
  what: (checkout) => ({ dir: 'what', plugins: [whatAliases(checkout)], jsx: 'automatic', jsxImportSource: 'what-framework', define: { __HYDRATABLE__: 'true' } }),
  solid1: () => ({ dir: 'solid1', plugins: [babelJsx({ presets: [[solidPresetV1, { generate: 'ssr', hydratable: true }]] })] }),
  solid2: () => ({ dir: 'solid2', plugins: [babelJsx({ plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'ssr', hydratable: true }]] })] }),
};

// The client: hydrate the page the server rendered, with the same rows.
const CLIENTS = {
  whatc: (checkout, compiler, hydratable) => ({
    source: `import { hydrate } from 'what-framework';
import { App } from './app.jsx';
import { buildRows } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
window.__hydrate = () => hydrate(<App rows={rows} selected={${SELECTED_ID}} />, document.getElementById('main'));`,
    jsx: { plugins: [[compiler, { production: true, ...(hydratable ? { hydratable: true } : {}) }]] },
    plugins: [whatAliases(checkout), babelJsx({ parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { production: true, ...(hydratable ? { hydratable: true } : {}) }]] })],
  }),
  what: (checkout) => ({
    source: `import { h, hydrate } from 'what-framework';
import { App } from './app.jsx';
import { buildRows } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
window.__hydrate = () => hydrate(h(App, { rows, selected: ${SELECTED_ID} }), document.getElementById('main'));`,
    esbuildJsx: { jsx: 'automatic', jsxImportSource: 'what-framework' },
    plugins: [whatAliases(checkout)],
  }),
  solid1: () => ({
    source: `import { hydrate } from 'solid-js/web';
import { App } from './app.jsx';
import { buildRows } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
window.__hydrate = () => hydrate(() => <App rows={rows} selected={${SELECTED_ID}} />, document.getElementById('main'));`,
    jsx: { presets: [[solidPresetV1, { generate: 'dom', hydratable: true }]] },
    plugins: [babelJsx({ presets: [[solidPresetV1, { generate: 'dom', hydratable: true }]] })],
  }),
  solid2: () => ({
    source: `import { hydrate } from '@solidjs/web';
import { App } from './app.jsx';
import { buildRows } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
window.__hydrate = () => hydrate(() => <App rows={rows} selected={${SELECTED_ID}} />, document.getElementById('main'));`,
    jsx: { plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'dom', hydratable: true }]] },
    plugins: [babelJsx({ plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'dom', hydratable: true }]] })],
  }),
};

async function serverPage(name, kind, checkout, compiler) {
  const config = SERVERS[kind](checkout, compiler);
  const outfile = path.join(outDir, `${name}.server.mjs`);
  await build({
    entryPoints: [path.join(here, 'frameworks', config.dir, 'entry.jsx')],
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', absWorkingDir: here,
    plugins: config.plugins, jsx: config.jsx, jsxImportSource: config.jsxImportSource,
    define: { 'process.env.NODE_ENV': '"production"', ...config.define },
  });
  const mod = await import(pathToFileURL(outfile).href + '?' + Date.now());
  const body = mod.renderString(buildRows(ROWS), SELECTED_ID);
  let head = '';
  if (kind === 'solid1') head = (await import(requireFrom('frameworks/solid1').resolve('solid-js/web'))).generateHydrationScript();
  if (kind === 'solid2') {
    const web = await import(pathToFileURL(createRequire(path.join(here, 'frameworks/solid2/package.json')).resolve('@solidjs/web')).href);
    if (web.generateHydrationScript) head = web.generateHydrationScript();
  }
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><div id="main">${body}</div></body></html>`;
}

async function clientBundle(name, kind, checkout, compiler, hydratable) {
  const config = CLIENTS[kind](checkout, compiler, hydratable);
  const dir = path.join(here, 'frameworks', kind === 'whatc' || kind === 'what' ? kind : kind);
  const contents = config.jsx
    ? (await transformAsync(config.source, { filename: path.join(dir, 'client.jsx'), babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, ...config.jsx })).code
    : config.source;
  const result = await build({
    stdin: { contents, resolveDir: dir, sourcefile: 'client.jsx', loader: 'jsx' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', minify: true, logLevel: 'warning',
    absWorkingDir: here, plugins: config.plugins, conditions: ['production', 'browser'],
    ...(config.esbuildJsx || {}),
    define: { 'process.env.NODE_ENV': '"production"', __WHAT_DEV__: 'false' },
  });
  const code = result.outputFiles[0].text;
  await writeFile(path.join(outDir, `${name}.client.js`), code);
  return code;
}

async function measure(browser, html, code) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setContent(html);
    await page.addScriptTag({ content: code, type: 'module' });
    await page.waitForFunction(() => typeof window.__hydrate === 'function');
    const result = await page.evaluate(async () => {
      const main = document.getElementById('main');
      const before = new Set();
      const walk = (visit) => {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_ALL);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) visit(n);
      };
      walk((n) => before.add(n));
      const t0 = performance.now();
      window.__hydrate();
      const t1 = performance.now();
      const row = main.querySelectorAll('tbody tr')[4];
      row.querySelector('a.lbl').click();
      await Promise.resolve();
      const selected = main.querySelectorAll('tbody tr')[4].className === 'danger';
      const t2 = performance.now();
      let created = 0;
      walk((n) => { if (!before.has(n)) created++; });
      return { hydrate: t1 - t0, interactive: t2 - t0, created, selected, rows: main.querySelectorAll('tbody tr').length };
    });
    if (errors.length) throw new Error(errors.join('\n'));
    if (!result.selected) throw new Error('a click on a row label did not select the row');
    if (result.rows !== ROWS) throw new Error(`${result.rows} rows after hydrating`);
    return result;
  } finally {
    await page.close();
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

await mkdir(outDir, { recursive: true });
const entries = [];
const current = await whatCompiler(repo);
for (const kind of ['whatc', 'what', 'solid1', 'solid2']) entries.push({ name: kind, kind, checkout: repo, compiler: current, hydratable: true });
if (beforeAt) {
  const old = await whatCompiler(beforeAt);
  entries.push({ name: 'before.whatc', kind: 'whatc', checkout: beforeAt, compiler: old, hydratable: false });
  entries.push({ name: 'before.what', kind: 'what', checkout: beforeAt, compiler: old, hydratable: false });
}

const browser = await chromium.launch();
const rowsOut = [];
try {
  for (const entry of entries) {
    const html = await serverPage(entry.name, entry.kind, entry.checkout, entry.compiler);
    const code = await clientBundle(entry.name, entry.kind, entry.checkout, entry.compiler, entry.hydratable);
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, html, code));
    const row = {
      entry: entry.name,
      hydrateMs: +median(runs.map((r) => r.hydrate)).toFixed(2),
      interactiveMs: +median(runs.map((r) => r.interactive)).toFixed(2),
      created: median(runs.map((r) => r.created)),
      clientGzip: gzipSync(code).length,
    };
    rowsOut.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  await browser.close();
}
console.log(`\n${ROWS} rows, ${RUNS} runs each (median), Chromium ${browser.version()}`);
console.log('| entry | hydrate (ms) | interactive (ms) | nodes created | client (gzip B) |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rowsOut) console.log(`| ${r.entry} | ${r.hydrateMs} | ${r.interactiveMs} | ${r.created} | ${r.clientGzip} |`);
