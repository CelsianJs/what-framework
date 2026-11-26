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
// With --before <dir>, the What entries are also built from another What
// checkout, server and client: the behaviour to compare against. `before.what`
// always; `before.whatc` only when that checkout's compiler has a server target
// (what 0.14's has none, and is skipped with a message).
//
// Every client is built as an app ships it: the What clients resolve the
// `production` export condition, the published dist/*.min.js, so each checkout
// must be built (`node scripts/build.js`). React is not measured: there is no
// React entry.
//
// Two pages: the table (1,000 rows) and the component page (CARD_COUNT small
// components, shared/data.mjs buildCards, frameworks/*/cards.jsx).
//
// Per run, in a fresh page: the server's HTML is in the document, the client
// bundle has loaded, and the page then measures `hydrate`, the time the
// hydrate() call takes; `interactive`, from that call until a click on a row's
// label has selected the row (on the component page: a click on a card's
// button has counted); and `created`, the nodes in the page that were not
// there before hydrating (adopting every node the server wrote adds none).
// `render` is the same client bundle rendering the same page into an empty
// container (What mount(), Solid render()) in a fresh page, the cost hydrating
// is there to avoid. Reported: the median of the runs, hydrate / render, and
// the client bundle's gzip size. The rows are also written to
// dist/hydrate/results.json, which bench.mjs puts in RESULTS.md when they were
// measured at the commit it reports.
//
// Usage: node hydrate.mjs [--quick] [--before <what-fw checkout>]

import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright';
import { buildRows, buildCards, CARD_COUNT, SELECTED_ID } from './shared/data.mjs';

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

// what-framework and its subpaths from a checkout, resolved through each
// package's exports with `conditions`, as a bundler with those conditions
// resolves them: the clients get the production dist, the servers the source.
const CLIENT_CONDITIONS = ['production', 'browser', 'import', 'default'];
const SERVER_CONDITIONS = ['import', 'default'];

function whatAliases(checkout, conditions) {
  const pick = (entry) => {
    if (typeof entry === 'string') return entry;
    for (const [condition, value] of Object.entries(entry)) {
      const target = conditions.includes(condition) ? pick(value) : null;
      if (target) return target;
    }
    return null;
  };
  return {
    name: 'what-sources',
    setup(b) {
      b.onResolve({ filter: /^what-(framework|core|server)(\/.*)?$/ }, (resolveArgs) => {
        const [, pkg, sub = ''] = resolveArgs.path.match(/^what-(framework|core|server)(\/.*)?$/);
        const dir = path.join(checkout, 'packages', pkg === 'framework' ? 'what' : pkg);
        const pkgJson = createRequire(path.join(dir, 'package.json'))(path.join(dir, 'package.json'));
        const file = path.join(dir, pick(pkgJson.exports['.' + sub]));
        if (!existsSync(file)) throw new Error(`${file} does not exist: run \`node scripts/build.js\` in ${checkout}`);
        return { path: file };
      });
    },
  };
}

// A compiler without a server target ignores `generate: 'ssr'` and emits
// client code, which cannot render on a server.
async function hasServerTarget(compiler) {
  const out = await transformAsync('export const A = () => <div />;', {
    babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { generate: 'ssr', production: true }]],
  });
  return out.code.includes('what-framework/ssr-runtime');
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
  whatc: (checkout, compiler) => ({ dir: 'whatc', plugins: [whatAliases(checkout, SERVER_CONDITIONS), babelJsx({ parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { generate: 'ssr', production: true }]] })], define: { __HYDRATABLE__: 'true' } }),
  what: (checkout) => ({ dir: 'what', plugins: [whatAliases(checkout, SERVER_CONDITIONS)], jsx: 'automatic', jsxImportSource: 'what-framework', define: { __HYDRATABLE__: 'true' } }),
  solid1: () => ({ dir: 'solid1', plugins: [babelJsx({ presets: [[solidPresetV1, { generate: 'ssr', hydratable: true }]] })] }),
  solid2: () => ({ dir: 'solid2', plugins: [babelJsx({ plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'ssr', hydratable: true }]] })] }),
};

// The client: hydrate the page the server rendered, with the same rows.
const CLIENTS = {
  whatc: (checkout, compiler, hydratable) => ({
    source: `import { hydrate, mount } from 'what-framework';
import { App } from './app.jsx';
import { Cards } from './cards.jsx';
import { buildRows, buildCards } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
const cards = buildCards(${CARD_COUNT});
const main = () => document.getElementById('main');
window.__pages = {
  table: { hydrate: () => hydrate(<App rows={rows} selected={${SELECTED_ID}} />, main()), render: () => mount(<App rows={rows} selected={${SELECTED_ID}} />, main()) },
  cards: { hydrate: () => hydrate(<Cards cards={cards} />, main()), render: () => mount(<Cards cards={cards} />, main()) },
};`,
    jsx: { plugins: [[compiler, { production: true, ...(hydratable ? { hydratable: true } : {}) }]] },
    plugins: [whatAliases(checkout, CLIENT_CONDITIONS), babelJsx({ parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { production: true, ...(hydratable ? { hydratable: true } : {}) }]] })],
  }),
  what: (checkout) => ({
    source: `import { h, hydrate, mount } from 'what-framework';
import { App } from './app.jsx';
import { Cards } from './cards.jsx';
import { buildRows, buildCards } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
const cards = buildCards(${CARD_COUNT});
const main = () => document.getElementById('main');
window.__pages = {
  table: { hydrate: () => hydrate(h(App, { rows, selected: ${SELECTED_ID} }), main()), render: () => mount(h(App, { rows, selected: ${SELECTED_ID} }), main()) },
  cards: { hydrate: () => hydrate(h(Cards, { cards }), main()), render: () => mount(h(Cards, { cards }), main()) },
};`,
    esbuildJsx: { jsx: 'automatic', jsxImportSource: 'what-framework' },
    plugins: [whatAliases(checkout, CLIENT_CONDITIONS)],
  }),
  solid1: () => ({
    source: `import { hydrate, render } from 'solid-js/web';
import { App } from './app.jsx';
import { Cards } from './cards.jsx';
import { buildRows, buildCards } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
const cards = buildCards(${CARD_COUNT});
const main = () => document.getElementById('main');
window.__pages = {
  table: { hydrate: () => hydrate(() => <App rows={rows} selected={${SELECTED_ID}} />, main()), render: () => render(() => <App rows={rows} selected={${SELECTED_ID}} />, main()) },
  cards: { hydrate: () => hydrate(() => <Cards cards={cards} />, main()), render: () => render(() => <Cards cards={cards} />, main()) },
};`,
    jsx: { presets: [[solidPresetV1, { generate: 'dom', hydratable: true }]] },
    plugins: [babelJsx({ presets: [[solidPresetV1, { generate: 'dom', hydratable: true }]] })],
  }),
  solid2: () => ({
    source: `import { hydrate, render } from '@solidjs/web';
import { App } from './app.jsx';
import { Cards } from './cards.jsx';
import { buildRows, buildCards } from '../../shared/data.mjs';
const rows = buildRows(${ROWS});
const cards = buildCards(${CARD_COUNT});
const main = () => document.getElementById('main');
window.__pages = {
  table: { hydrate: () => hydrate(() => <App rows={rows} selected={${SELECTED_ID}} />, main()), render: () => render(() => <App rows={rows} selected={${SELECTED_ID}} />, main()) },
  cards: { hydrate: () => hydrate(() => <Cards cards={cards} />, main()), render: () => render(() => <Cards cards={cards} />, main()) },
};`,
    jsx: { plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'dom', hydratable: true }]] },
    plugins: [babelJsx({ plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'dom', hydratable: true }]] })],
  }),
};

async function serverPages(name, kind, checkout, compiler) {
  const config = SERVERS[kind](checkout, compiler);
  const outfile = path.join(outDir, `${name}.server.mjs`);
  await build({
    entryPoints: [path.join(here, 'frameworks', config.dir, 'entry.jsx')],
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', absWorkingDir: here,
    plugins: config.plugins, jsx: config.jsx, jsxImportSource: config.jsxImportSource,
    define: { 'process.env.NODE_ENV': '"production"', ...config.define },
  });
  const mod = await import(pathToFileURL(outfile).href + '?' + Date.now());
  const bodies = { table: mod.renderString(buildRows(ROWS), SELECTED_ID), cards: mod.renderCards(buildCards(CARD_COUNT)) };
  let head = '';
  if (kind === 'solid1') head = (await import(requireFrom('frameworks/solid1').resolve('solid-js/web'))).generateHydrationScript();
  if (kind === 'solid2') {
    const web = await import(pathToFileURL(createRequire(path.join(here, 'frameworks/solid2/package.json')).resolve('@solidjs/web')).href);
    if (web.generateHydrationScript) head = web.generateHydrationScript();
  }
  const doc = (body) => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><div id="main">${body}</div></body></html>`;
  return { table: doc(bodies.table), cards: doc(bodies.cards), empty: doc('') };
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

// One hydration of `pageName` (the server's HTML in the document), timed, then
// a click that has to work.
async function measure(browser, html, code, pageName) {
  return inPage(browser, html, code, (page) => page.evaluate(async (name) => {
    const main = document.getElementById('main');
    const before = new Set();
    const walk = (visit) => {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_ALL);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) visit(n);
    };
    walk((n) => before.add(n));
    const t0 = performance.now();
    window.__pages[name].hydrate();
    const t1 = performance.now();
    let worked;
    let count;
    if (name === 'table') {
      main.querySelectorAll('tbody tr')[4].querySelector('a.lbl').click();
      await Promise.resolve();
      worked = main.querySelectorAll('tbody tr')[4].className === 'danger';
      count = main.querySelectorAll('tbody tr').length;
    } else {
      const button = main.querySelectorAll('.card button.inc')[4];
      const was = Number(button.textContent);
      button.click();
      await Promise.resolve();
      worked = Number(main.querySelectorAll('.card button.inc')[4].textContent) === was + 1;
      count = main.querySelectorAll('.card').length;
    }
    const t2 = performance.now();
    let created = 0;
    walk((n) => { if (!before.has(n)) created++; });
    return { hydrate: t1 - t0, interactive: t2 - t0, created, worked, count };
  }, pageName), pageName);
}

// One client render of `pageName` into the empty container, timed.
async function measureRender(browser, html, code, pageName) {
  return inPage(browser, html, code, (page) => page.evaluate((name) => {
    const t0 = performance.now();
    window.__pages[name].render();
    const t1 = performance.now();
    const main = document.getElementById('main');
    const count = main.querySelectorAll(name === 'table' ? 'tbody tr' : '.card').length;
    return { render: t1 - t0, worked: true, count };
  }, pageName), pageName);
}

async function inPage(browser, html, code, run, pageName) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setContent(html);
    await page.addScriptTag({ content: code, type: 'module' });
    await page.waitForFunction(() => typeof window.__pages === 'object');
    const result = await run(page);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!result.worked) throw new Error(`${pageName}: a click after hydrating did not update the page`);
    const want = pageName === 'table' ? ROWS : CARD_COUNT;
    if (result.count !== want) throw new Error(`${pageName}: ${result.count} items, expected ${want}`);
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
  if (await hasServerTarget(old)) entries.push({ name: 'before.whatc', kind: 'whatc', checkout: beforeAt, compiler: old, hydratable: false });
  else console.log(`Skipping before.whatc: the compiler in ${beforeAt} has no server target (generate: 'ssr').`);
  entries.push({ name: 'before.what', kind: 'what', checkout: beforeAt, compiler: old, hydratable: false });
}

const PAGES = { table: `the table, ${ROWS} rows`, cards: `the component page, ${CARD_COUNT} components` };
const browser = await chromium.launch();
const rowsOut = [];
try {
  for (const entry of entries) {
    const html = await serverPages(entry.name, entry.kind, entry.checkout, entry.compiler);
    const code = await clientBundle(entry.name, entry.kind, entry.checkout, entry.compiler, entry.hydratable);
    for (const pageName of Object.keys(PAGES)) {
      const runs = [];
      const renders = [];
      // Hydration and client render alternate, so load on the machine reaches both alike.
      for (let i = 0; i < RUNS; i++) {
        runs.push(await measure(browser, html[pageName], code, pageName));
        renders.push(await measureRender(browser, html.empty, code, pageName));
      }
      const hydrateMs = median(runs.map((r) => r.hydrate));
      const renderMs = median(renders.map((r) => r.render));
      const row = {
        page: pageName,
        entry: entry.name,
        hydrateMs: +hydrateMs.toFixed(2),
        interactiveMs: +median(runs.map((r) => r.interactive)).toFixed(2),
        renderMs: +renderMs.toFixed(2),
        ratio: +(hydrateMs / renderMs).toFixed(2),
        created: median(runs.map((r) => r.created)),
        clientGzip: gzipSync(code).length,
      };
      rowsOut.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  await browser.close();
}
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } })();
await writeFile(path.join(outDir, 'results.json'), JSON.stringify({
  date: new Date().toISOString(), git: commit, quick, runs: RUNS, chromium: browser.version(), loadavg: os.loadavg().map((v) => +v.toFixed(2)),
  pages: PAGES, rows: rowsOut,
}, null, 1) + '\n');
console.log(`\n${RUNS} runs each (median), Chromium ${browser.version()}`);
for (const [pageName, title] of Object.entries(PAGES)) {
  console.log(`\n${title}\n`);
  console.log('| entry | hydrate (ms) | interactive (ms) | client render (ms) | hydrate / render | nodes created | client (gzip B) |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rowsOut.filter((x) => x.page === pageName)) console.log(`| ${r.entry} | ${r.hydrateMs} | ${r.interactiveMs} | ${r.renderMs} | ${r.ratio} | ${r.created} | ${r.clientGzip} |`);
}
