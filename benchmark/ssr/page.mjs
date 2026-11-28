#!/usr/bin/env node
// An ordinary page (frameworks/whatc/page.jsx: a storefront with components,
// context, a keyed list of components, reactive text and attributes, <Show>,
// an <ErrorBoundary>, a <Suspense> around a resource, an island and a form)
// rendered by what-compiler's server target: string render, plain and
// hydratable, the stream, and heap allocated per render.
//
// With --before <dir>, the same page is also built with another What
// checkout's compiler and packages, the two are checked to render the same
// HTML, and every measurement alternates between them, round by round, in
// fresh processes: on a loaded machine read the ratio, not the times.
//
// It prints its table and writes nothing outside dist/page/.
//
// Usage: node page.mjs [--quick] [--before <what-fw checkout>]

import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(here, 'dist', 'page');
const args = process.argv.slice(2);
const PRODUCTS = 48;
const SELECTED = 1003;

// --- One measurement, in a fresh process ---------------------------------------

async function streamOnce(mod, products) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  mod.stream(products, SELECTED, sink);
  await finished(sink);
  return chunks.join('');
}

async function worker(job) {
  const mod = await import(pathToFileURL(job.bundle).href);
  const products = mod.buildProducts(PRODUCTS);
  const samples = [];
  if (job.op === 'html') {
    return { string: mod.renderString(products, SELECTED), stream: await streamOnce(mod, products) };
  }
  if (job.op === 'string') {
    for (let i = 0; i < job.warmup; i++) Buffer.from(mod.renderString(products, SELECTED));
    for (let i = 0; i < job.samples; i++) {
      const t0 = performance.now();
      Buffer.from(mod.renderString(products, SELECTED));
      samples.push(performance.now() - t0);
    }
  } else if (job.op === 'stream') {
    for (let i = 0; i < job.warmup; i++) await streamOnce(mod, products);
    for (let i = 0; i < job.samples; i++) {
      const t0 = performance.now();
      await streamOnce(mod, products);
      samples.push(performance.now() - t0);
    }
  } else {
    // Heap bytes allocated by one render: bench.mjs's memory job.
    for (let i = 0; i < job.warmup; i++) mod.renderString(products, SELECTED);
    for (let i = 0; i < job.samples; i++) {
      globalThis.gc();
      globalThis.gc();
      const before = process.memoryUsage().heapUsed;
      const html = mod.renderString(products, SELECTED);
      samples.push(process.memoryUsage().heapUsed - before);
      if (html.length === 0) throw new Error('empty render');
    }
  }
  return { samples };
}

if (args[0] === '--worker') {
  const result = JSON.stringify(await worker(JSON.parse(args[1])));
  // Exit once the pipe has taken all of it.
  await new Promise((resolve) => process.stdout.write(result, resolve));
  process.exit(0);
}

// --- Driver --------------------------------------------------------------------

const quick = args.includes('--quick');
const beforeAt = args.includes('--before') ? path.resolve(args[args.indexOf('--before') + 1]) : null;
const ROUNDS = quick ? 3 : 9;
const COUNTS = quick
  ? { string: [200, 200], stream: [60, 60], memory: [50, 9] }
  : { string: [500, 600], stream: [150, 200], memory: [200, 15] };

// what-framework and its subpaths from a checkout's sources (hydrate.mjs has
// the same for its clients).
function whatSources(checkout) {
  const pick = (entry) => {
    if (typeof entry === 'string') return entry;
    for (const [condition, value] of Object.entries(entry)) {
      const target = condition === 'import' || condition === 'default' ? pick(value) : null;
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
        return { path: path.join(dir, pick(pkgJson.exports['.' + sub])) };
      });
    },
  };
}

async function buildPage(label, checkout) {
  const compilerAt = path.join(checkout, 'packages/compiler/src/babel-plugin.js');
  if (!existsSync(compilerAt)) throw new Error(`${checkout} is not a what-fw checkout`);
  const compiler = (await import(pathToFileURL(compilerAt).href)).default;
  const jsx = {
    name: 'babel-jsx',
    setup(b) {
      b.onLoad({ filter: /\.jsx$/ }, async (loadArgs) => {
        const out = await transformAsync(await readFile(loadArgs.path, 'utf8'), {
          filename: loadArgs.path, babelrc: false, configFile: false, sourceMaps: false,
          parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { generate: 'ssr', production: true }]],
        });
        return { contents: out.code, loader: 'js' };
      });
    },
  };
  const bundles = {};
  for (const mode of ['plain', 'hydratable']) {
    bundles[mode] = path.join(outDir, `${label}.${mode}.mjs`);
    await build({
      entryPoints: [path.join(here, 'frameworks/whatc/page-entry.jsx')],
      outfile: bundles[mode],
      bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: false, logLevel: 'warning',
      absWorkingDir: here,
      plugins: [whatSources(checkout), jsx],
      banner: { js: "import { createRequire as __pageCreateRequire } from 'node:module'; const require = __pageCreateRequire(import.meta.url);" },
      define: { 'process.env.NODE_ENV': '"production"', __HYDRATABLE__: String(mode === 'hydratable') },
    });
  }
  return bundles;
}

function run(job, nodeArgs = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, fileURLToPath(import.meta.url), '--worker', JSON.stringify(job)], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`job failed: ${JSON.stringify(job)}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

// What differs between two renders of one page: each render's salt and its
// keyed lists' digests under it, and the stream's random boundary ids.
function stable(html) {
  return html
    .replace(/<!--k:[^>]*-->/g, (comment) => `<!--k:${(comment.length - 21) / 11}-->`)
    .replace(/wb[0-9a-z]+-(\d+)/g, 'wb$1')
    .replace(/"salt":"[^"]*"/g, '"salt":""');
}

const entries = [];
if (beforeAt) entries.push(['before', await buildPage('before', beforeAt)]);
entries.push(['working tree', await buildPage('after', repo)]);

const pages = entries.map(([label, bundles]) => ({
  label,
  plain: run({ bundle: bundles.plain, op: 'html' }),
  hydratable: run({ bundle: bundles.hydratable, op: 'html' }),
}));
for (const page of pages) {
  if (!page.plain.string.includes('class="card dark selected"') || !page.hydratable.stream.includes('Exactly as pictured.')) {
    throw new Error(`${page.label}: the page did not render what page.jsx describes`);
  }
}
if (pages.length === 2) {
  for (const [mode, kind] of [['plain', 'string'], ['hydratable', 'string'], ['hydratable', 'stream']]) {
    if (stable(pages[0][mode][kind]) !== stable(pages[1][mode][kind])) {
      throw new Error(`the two checkouts render different HTML (${mode} ${kind})`);
    }
  }
  console.log('same HTML from both checkouts: plain string, hydratable string, stream');
}

const JOBS = [
  ['string, plain (ms)', 'plain', 'string', []],
  ['string, hydratable (ms)', 'hydratable', 'string', []],
  ['stream (ms)', 'hydratable', 'stream', []],
  ['heap per render, plain (KB)', 'plain', 'memory', ['--expose-gc', '--max-semi-space-size=256']],
];
const results = JOBS.map(() => entries.map(() => []));
for (let round = 0; round < ROUNDS; round++) {
  JOBS.forEach(([, mode, op, nodeArgs], j) => {
    // Alternate which checkout goes first.
    const order = entries.map((_, i) => i);
    if (round % 2) order.reverse();
    for (const i of order) {
      const [warmup, samples] = COUNTS[op];
      results[j][i].push(median(run({ bundle: entries[i][1][mode], op, warmup, samples }, nodeArgs).samples));
    }
  });
}

const fmt = (value, op) => (op === 'memory' ? (value / 1024).toFixed(0) : value.toFixed(3));
console.log(`\n${PRODUCTS} products, ${pages[pages.length - 1].plain.string.length} bytes plain, ${ROUNDS} rounds (median of round medians), load average ${os.loadavg().map((n) => n.toFixed(0)).join(' ')}`);
console.log(`| | ${entries.map(([label]) => label).join(' | ')} |${entries.length === 2 ? ' working tree / before |' : ''}`);
console.log(`|---|${entries.map(() => '---:|').join('')}${entries.length === 2 ? '---:|' : ''}`);
JOBS.forEach(([title, , op], j) => {
  const values = results[j].map(median);
  const ratio = entries.length === 2 ? ` ${(values[1] / values[0]).toFixed(2)} |` : '';
  console.log(`| ${title} | ${values.map((v) => fmt(v, op)).join(' | ')} |${ratio}`);
});
