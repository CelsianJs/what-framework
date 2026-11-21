#!/usr/bin/env node
// js-framework-benchmark (krausest) style driver.
//
// Methodology (documented in README.md, caveats in RESULTS.md):
//   - Serves the vite production builds from dist/ on port 4870 (Track D range).
//   - Chromium via Playwright (resolved from the repo root's devDependency),
//     headless, one fresh page per framework and throttle rate.
//   - Each operation: prep steps (not measured), then ONE measured click.
//   - total: performance.now() before the synchronous click() dispatch to a
//     double requestAnimationFrame after it, i.e. script + style + layout +
//     the frame the browser commits after the work ("action -> paint-settle").
//     This is an in-page approximation of krausest's CDP-timeline metric; it
//     EXCLUDES raster/composite and carries a frame-scheduling floor of
//     roughly 8-10 ms that hides the script cost of cheap operations.
//   - script (opt-in, on in the CLI): the same start, stopped when the click's
//     task and every microtask it queued have run, before any rendering. A
//     MessageChannel message posted right after click() fires after the
//     microtask checkpoint and after any message a framework scheduler posted
//     during the click (same task source, FIFO); a requestAnimationFrame
//     registered at the same point covers the case where the browser renders
//     before delivering the message. Whichever fires first stops the clock.
//     Observed in this harness: vanilla and Solid 1.9 finish synchronously
//     inside the click; React 19 (discrete event priority) and Solid 2.0 flush
//     in a microtask; what flushes synchronously at the end of batch() (create,
//     replace, update, clear) and in a microtask after a bare signal write
//     (select, swap, remove, append). Nothing defers past the microtask
//     checkpoint. The DOM is checked at the stop instant on every sample: a
//     framework that deferred work to a timer or a later frame fails the run
//     instead of reporting a too-small number.
//     When the script metric is on, pages are served cross-origin isolated
//     (COOP/COEP), which raises performance.now() resolution from 100 us to
//     5 us; the gate path (dom-gate.mjs) keeps the old non-isolated serving.
//   - CPU throttling (opt-in): Emulation.setCPUThrottlingRate through a
//     Playwright CDP session, applied around each measured click only (prep
//     runs unthrottled), as the official harness does. One uniform rate for
//     every op; the official harness picks a rate per op.
//   - Warmup iterations are discarded; tables report the MEDIAN of the
//     measured samples (mean/min/stddev/samples are kept in results.json).
//   - Every measured op is verified against the DOM after the frame (and at
//     the script stop point when that metric is on): row counts, ids of moved,
//     kept, removed and appended rows, updated labels and the selection class,
//     so a framework can't "win" by skipping work.
//   - Bundle size is the raw, gzip (level 9) and brotli (quality 11) size of
//     every JS asset in dist/<fw>/. dist/<fw>/packages.json (written by
//     build-all.mjs from the bundler's module graph) must show the expected
//     framework major in the bundle, or the framework is refused.
//
// Usage:  node bench.mjs [--quick] [--throttle <rate>[,<rate>...]] [framework ...]
//   Default rates: 1,4 (one table each); --quick defaults to 1 only.

import http from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants as zlib } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist');

export const ALL_FRAMEWORKS = ['vanilla', 'what', 'react', 'solid', 'solid2'];

export const FRAMEWORK_LABELS = {
  vanilla: 'vanilla',
  what: 'what',
  react: 'react 19',
  solid: 'solid 1.9',
  solid2: 'solid 2.0',
};

// The label claims a version; the bundle has to back it up. Each entry is a
// package that must appear exactly once in dist/<fw>/packages.json with a
// version starting with the given prefix; `absent` packages must not appear.
const EXPECTED_PACKAGES = {
  react: { present: { react: '19.', 'react-dom': '19.' } },
  solid: { present: { 'solid-js': '1.9.' }, absent: ['@solidjs/signals', '@solidjs/web'] },
  solid2: { present: { 'solid-js': '2.0.', '@solidjs/web': '2.0.', '@solidjs/signals': '2.0.' } },
};

// ---------------------------------------------------------------------------
// Static file server for dist/
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const ISOLATION_HEADERS = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
function createServer({ isolated }) {
  return http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let filePath = path.normalize(path.join(distDir, urlPath));
      if (!filePath.startsWith(distDir)) { res.writeHead(403); return res.end(); }
      if (filePath.endsWith(path.sep) || !path.extname(filePath)) filePath = path.join(filePath, 'index.html');
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream', ...(isolated ? ISOLATION_HEADERS : {}) });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
}

// ---------------------------------------------------------------------------
// In-page DOM helpers. `snapshot` and `check` in OPS are serialized into the
// page, so they must be self-contained arrow functions over (tbody, h, snap).
// Every helper is an O(1)-ish structural read: no style or layout access, so
// a check at the script stop point does not pull rendering work forward.
// ---------------------------------------------------------------------------
const PAGE_HELPERS = {
  rows: (tb) => tb.children.length,
  id: (tb, i) => +tb.children[i].firstElementChild.textContent,
  label: (tb, i) => tb.children[i].children[1].firstElementChild.textContent,
  selected: (tb, i) => tb.children[i].classList.contains('danger'),
};

// ---------------------------------------------------------------------------
// Operations — prep is unmeasured, `act` is the measured click, `check`
// returns '' when the DOM shows the op's full effect, else what is missing.
// ---------------------------------------------------------------------------
export const OPS = [
  {
    id: 'create1k', label: 'create 1,000 rows', warmup: 5,
    prep: async (p) => { await clickAndSettle(p, '#clear'); },
    act: '#run',
    snapshot: () => null,
    check: (tb, h) => (h.rows(tb) !== 1000 ? `expected 1000 rows, got ${h.rows(tb)}`
      : h.id(tb, 999) !== h.id(tb, 0) + 999 ? 'row ids not consecutive' : ''),
  },
  {
    id: 'replace1k', label: 'replace all 1,000 rows', warmup: 3,
    prep: async (p) => { if (await rowCount(p) !== 1000) await clickAndSettle(p, '#run'); },
    act: '#run',
    snapshot: (tb, h) => ({ first: h.id(tb, 0) }),
    check: (tb, h, s) => (h.rows(tb) !== 1000 ? `expected 1000 rows, got ${h.rows(tb)}`
      : h.id(tb, 0) === s.first ? 'rows not replaced'
        : h.id(tb, 999) !== h.id(tb, 0) + 999 ? 'row ids not consecutive' : ''),
  },
  {
    id: 'update10th', label: 'partial update (every 10th of 1,000)', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#update',
    snapshot: (tb, h) => ({ l0: h.label(tb, 0), l1: h.label(tb, 1), l990: h.label(tb, 990) }),
    check: (tb, h, s) => (h.rows(tb) !== 1000 ? `expected 1000 rows, got ${h.rows(tb)}`
      : h.label(tb, 0) !== `${s.l0} !!!` || h.label(tb, 990) !== `${s.l990} !!!` ? 'rows 1/991 not updated'
        : h.label(tb, 1) !== s.l1 ? 'row 2 updated' : ''),
  },
  {
    id: 'select', label: 'select row', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: 'tbody tr:nth-child(2) a.lbl',
    snapshot: () => null,
    check: (tb, h) => (!h.selected(tb, 1) ? 'row 2 not selected'
      : h.selected(tb, 0) || h.selected(tb, 2) ? 'neighbour rows selected' : ''),
  },
  {
    id: 'swap', label: 'swap rows (2 and 999)', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#swaprows',
    snapshot: (tb, h) => ({ a: h.id(tb, 1), b: h.id(tb, 998) }),
    check: (tb, h, s) => (h.rows(tb) !== 1000 ? `expected 1000 rows, got ${h.rows(tb)}`
      : h.id(tb, 1) !== s.b || h.id(tb, 998) !== s.a ? 'rows 2 and 999 not swapped' : ''),
  },
  {
    id: 'remove', label: 'remove one row', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: 'tbody tr:nth-child(4) a.remove',
    snapshot: (tb, h) => ({ prev: h.id(tb, 2), next: h.id(tb, 4) }),
    check: (tb, h, s) => (h.rows(tb) !== 999 ? `expected 999 rows, got ${h.rows(tb)}`
      : h.id(tb, 2) !== s.prev || h.id(tb, 3) !== s.next ? 'row 4 not removed in place' : ''),
  },
  {
    id: 'create10k', label: 'create 10,000 rows', warmup: 1, heavy: true,
    prep: async (p) => { await clickAndSettle(p, '#clear'); },
    act: '#runlots',
    snapshot: () => null,
    check: (tb, h) => (h.rows(tb) !== 10000 ? `expected 10000 rows, got ${h.rows(tb)}`
      : h.id(tb, 9999) !== h.id(tb, 0) + 9999 ? 'row ids not consecutive' : ''),
  },
  {
    id: 'append1k', label: 'append 1,000 to 1,000 rows', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#add',
    snapshot: (tb, h) => ({ first: h.id(tb, 0), last: h.id(tb, 999) }),
    check: (tb, h, s) => (h.rows(tb) !== 2000 ? `expected 2000 rows, got ${h.rows(tb)}`
      : h.id(tb, 0) !== s.first || h.id(tb, 999) !== s.last ? 'existing rows not kept'
        : h.id(tb, 1000) !== s.last + 1 || h.id(tb, 1999) !== s.last + 1000 ? 'rows not appended' : ''),
  },
  {
    id: 'clear1k', label: 'clear 1,000 rows', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#clear',
    snapshot: () => null,
    check: (tb, h) => (h.rows(tb) !== 0 ? `expected 0 rows, got ${h.rows(tb)}` : ''),
  },
];

const fnMap = (entries) => `{${entries.map(([k, fn]) => `${JSON.stringify(k)}:${fn}`).join(',')}}`;
const PAGE_SCRIPT = `window.__krausest = {h:${fnMap(Object.entries(PAGE_HELPERS))},ops:{${OPS.map((op) =>
  `${JSON.stringify(op.id)}:${fnMap([['snapshot', op.snapshot], ['check', op.check]])}`).join(',')}}};`;

// ---------------------------------------------------------------------------
// In-page measurement
// ---------------------------------------------------------------------------
async function clickAndSettle(page, selector) {
  await page.evaluate((sel) => new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    if (!el) return reject(new Error(`no element: ${sel}`));
    el.click();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), selector);
}

async function measureOp(page, op, scriptMetric) {
  return page.evaluate(({ opId, sel, scriptMetric }) => new Promise((resolve, reject) => {
    const { h, ops } = window.__krausest;
    const { snapshot, check } = ops[opId];
    const tb = document.querySelector('tbody');
    const el = document.querySelector(sel);
    if (!el) return reject(new Error(`no element: ${sel}`));
    const snap = snapshot(tb, h);
    let script = null;
    let scriptVia = null;
    let scriptError = '';
    const stopScript = (via) => {
      if (script !== null) return;
      script = performance.now() - start;
      scriptVia = via;
      scriptError = check(tb, h, snap);
    };
    const channel = scriptMetric ? new MessageChannel() : null;
    if (channel) channel.port1.onmessage = () => stopScript('message');
    const start = performance.now();
    el.click();
    if (channel) {
      channel.port2.postMessage(null);
      requestAnimationFrame(() => stopScript('frame'));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const total = performance.now() - start;
      if (channel) channel.port1.close();
      resolve({ total, script, scriptVia, scriptError, error: check(tb, h, snap) });
    }));
  }), { opId: op.id, sel: op.act, scriptMetric });
}

async function rowCount(page) {
  return page.evaluate(() => document.querySelector('tbody').children.length);
}

function stats(samples, digits = 2) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const stddev = Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length);
  return {
    median: +median.toFixed(digits),
    mean: +mean.toFixed(digits),
    min: +sorted[0].toFixed(digits),
    stddev: +stddev.toFixed(digits),
    samples: samples.map((v) => +v.toFixed(digits)),
  };
}

// ---------------------------------------------------------------------------
// Build artifacts: bundle sizes and bundled package versions
// ---------------------------------------------------------------------------
export async function bundleSizes(fw) {
  const assets = path.join(distDir, fw, 'assets');
  const files = (await readdir(assets)).filter((f) => f.endsWith('.js')).sort();
  const size = { files, raw: 0, gzip: 0, brotli: 0 };
  for (const file of files) {
    const body = await readFile(path.join(assets, file));
    size.raw += body.length;
    size.gzip += gzipSync(body, { level: 9 }).length;
    size.brotli += brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } }).length;
  }
  return size;
}

export async function bundledPackages(fw) {
  const file = path.join(distDir, fw, 'packages.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

export function verifyBundledPackages(fw, packages) {
  const expected = EXPECTED_PACKAGES[fw];
  if (!expected) return;
  if (!packages) throw new Error(`dist/${fw}/packages.json missing: rebuild with \`npm run build\` in benchmark/krausest.`);
  for (const [name, prefix] of Object.entries(expected.present ?? {})) {
    const found = packages.filter((p) => p.name === name);
    if (found.length !== 1 || !found[0].version.startsWith(prefix)) {
      throw new Error(`dist/${fw} must bundle exactly one ${name}@${prefix}x; found ${found.map((p) => p.version).join(', ') || 'none'}.`);
    }
  }
  for (const name of expected.absent ?? []) {
    if (packages.some((p) => p.name === name)) throw new Error(`dist/${fw} must not bundle ${name}.`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
export async function captureBrowserProvenance(browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const version = await session.send('Browser.getVersion');
    let commandLine = null;
    let commandLineError = null;
    try {
      commandLine = (await session.send('Browser.getBrowserCommandLine')).arguments;
    } catch (err) {
      // Recent Playwright launches omit --enable-automation, so Chromium may
      // refuse this diagnostic. Do not add a flag just to obtain metadata.
      commandLineError = err.message;
    }
    return { version: browser.version(), ...version, commandLine, commandLineError };
  } finally {
    await session.detach();
  }
}

// Callers choose whether to include script timing alongside frame timing.
export async function runFrameworks(frameworks, {
  samples = 10, samplesHeavy = 5, warmup = null, log = false, provenance = false,
  throttle = 1, scriptMetric = false,
} = {}) {
  if (!(throttle >= 1)) throw new Error(`Invalid CPU throttling rate: ${throttle}`);
  for (const fw of frameworks) {
    if (!existsSync(path.join(distDir, fw, 'index.html'))) {
      throw new Error(`dist/${fw}/index.html missing: run \`npm run build\` in benchmark/krausest first.`);
    }
    verifyBundledPackages(fw, await bundledPackages(fw));
  }

  const { chromium } = await import('playwright'); // repo root devDependency
  const server = createServer({ isolated: scriptMetric });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const port = server.address().port;
  const launchOptions = { headless: true };
  let browser;
  let chromiumVersion;
  const results = {};
  let browserProvenance;

  try {
    browser = await chromium.launch(launchOptions);
    chromiumVersion = browser.version();
    for (const fw of frameworks) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/${fw}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#run');
      await page.evaluate(PAGE_SCRIPT);
      if (scriptMetric && !await page.evaluate(() => crossOriginIsolated)) {
        throw new Error(`${fw}: page is not cross-origin isolated; script timings would use the coarse 100 us clock.`);
      }
      const cdp = throttle > 1 ? await context.newCDPSession(page) : null;

      results[fw] = {};
      if (log) process.stdout.write(`\n${fw}${throttle > 1 ? ` @${throttle}x` : ''}`);
      for (const op of OPS) {
        const n = op.heavy ? samplesHeavy : samples;
        const w = warmup === null ? op.warmup : warmup;
        const total = [];
        const script = [];
        let scriptViaFrame = 0;
        for (let i = 0; i < w + n; i++) {
          await op.prep(page);
          if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
          const m = await measureOp(page, op, scriptMetric);
          if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          if (m.error) throw new Error(`${fw} ${op.id}: ${m.error}`);
          if (m.scriptError) {
            throw new Error(`${fw} ${op.id}: DOM incomplete once the click's microtasks had drained (${m.scriptError}); `
              + 'the framework deferred work past the microtask checkpoint, so its script time would be understated.');
          }
          if (i < w) continue;
          total.push(m.total);
          if (scriptMetric) {
            script.push(m.script);
            if (m.scriptVia === 'frame') scriptViaFrame++;
          }
        }
        results[fw][op.id] = stats(total);
        if (scriptMetric) results[fw][op.id].script = { ...stats(script, 3), stoppedByFrame: scriptViaFrame };
        if (log) process.stdout.write(` ${op.id}:${results[fw][op.id].median}${scriptMetric ? `/${results[fw][op.id].script.median}` : ''}ms`);
      }
      if (log) process.stdout.write('\n');
      await context.close();
    }
    // Collect after all measured operations, so diagnostic CDP traffic cannot
    // enter the timed click/double-rAF path or disturb its warmup sequence.
    if (provenance) browserProvenance = { ...await captureBrowserProvenance(browser), launchOptions };
  } finally {
    try { await browser?.close(); } finally { server.close(); }
  }

  return { results, chromiumVersion, ...(provenance ? { browser: browserProvenance } : {}) };
}

export async function runWhat({ samples = 10, samplesHeavy = 5 } = {}) {
  const { results } = await runFrameworks(['what'], { samples, samplesHeavy });
  return results.what;
}

// ---------------------------------------------------------------------------
// CLI: results.json + RESULTS.md
// ---------------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = { quick: false, throttle: null, frameworks: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quick') opts.quick = true;
    else if (arg === '--throttle' || arg.startsWith('--throttle=')) {
      const value = arg === '--throttle' ? argv[++i] : arg.slice('--throttle='.length);
      const rates = String(value ?? '').split(',').map(Number);
      if (!rates.length || rates.some((r) => !Number.isFinite(r) || r < 1)) {
        throw new Error(`Invalid --throttle ${value ?? ''}: expected rates >= 1, e.g. --throttle 4 or --throttle 1,4`);
      }
      opts.throttle = [...new Set(rates)];
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else if (!ALL_FRAMEWORKS.includes(arg)) throw new Error(`Unknown framework ${arg} (expected: ${ALL_FRAMEWORKS.join(', ')})`);
    else opts.frameworks.push(arg);
  }
  opts.throttle ??= opts.quick ? [1] : [1, 4];
  opts.frameworks = ALL_FRAMEWORKS.filter((f) => !opts.frameworks.length || opts.frameworks.includes(f));
  return opts;
}

function geomeanVsVanilla(results, fw, pick) {
  if (!results.vanilla) return null;
  const ratios = OPS.map((op) => pick(results[fw][op.id]) / Math.max(pick(results.vanilla[op.id]), 0.05));
  return +Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length).toFixed(2);
}

function rateTitle(rate) {
  return rate === 1 ? 'no CPU throttling' : `${rate}x CPU throttling`;
}

function renderResults({ meta, frameworks, runs }) {
  const fws = Object.keys(frameworks);
  const header = `| operation | ${fws.map((fw) => frameworks[fw].label).join(' | ')} |`;
  const rule = `|---|${fws.map(() => '---:').join('|')}|`;
  const kb = (bytes) => (bytes / 1024).toFixed(1);
  const lines = [];
  lines.push('# krausest-style keyed benchmark — results');
  lines.push('');
  if (meta.quick) {
    lines.push('> **SMOKE RUN (`--quick`): 3 samples per op (2 for create 10k), 1 warmup.');
    lines.push('> These numbers only prove the harness runs end to end; do not quote them.**');
    lines.push('');
  }
  lines.push(`Generated by \`bench.mjs\` on ${meta.date} (git ${meta.gitRev}, ${meta.durationSec}s wall time).`);
  lines.push('');
  lines.push(`- **Machine:** ${meta.machine.cpu} (${meta.machine.cores} cores, ${meta.machine.memGB} GB), ${meta.machine.platform} ${meta.machine.arch}`);
  lines.push(`- **Browser:** Chromium ${meta.chromium} (Playwright, headless) — Node ${meta.node}`);
  lines.push(`- **Samples:** median of ${meta.samplesPerOp} (create 10k: ${meta.samplesHeavy}) after warmup; all times in ms.`);
  lines.push(`- **Bundled versions:** ${fws.map((fw) => `${frameworks[fw].label} = ${frameworks[fw].packages.map((p) => `${p.name}@${p.version}`).join(' + ') || 'no dependencies'}`).join('; ')}`);
  lines.push('');
  for (const { throttle, results } of runs) {
    lines.push(`## ${rateTitle(throttle)} — click → double rAF (total)`);
    lines.push('');
    lines.push(header);
    lines.push(rule);
    for (const op of OPS) lines.push(`| ${op.label} | ${fws.map((fw) => `${results[fw][op.id].median} ±${results[fw][op.id].stddev}`).join(' | ')} |`);
    lines.push(`| **geometric mean (vs vanilla)** | ${fws.map((fw) => `**${geomeanVsVanilla(results, fw, (r) => r.median) ?? '—'}**`).join(' | ')} |`);
    lines.push('');
    lines.push(`## ${rateTitle(throttle)} — click → microtasks drained (script only)`);
    lines.push('');
    lines.push(header);
    lines.push(rule);
    for (const op of OPS) lines.push(`| ${op.label} | ${fws.map((fw) => `${results[fw][op.id].script.median} ±${results[fw][op.id].script.stddev}`).join(' | ')} |`);
    lines.push(`| **geometric mean (vs vanilla)** | ${fws.map((fw) => `**${geomeanVsVanilla(results, fw, (r) => r.script.median) ?? '—'}**`).join(' | ')} |`);
    lines.push('');
  }
  lines.push('## JS bundle size (kB)');
  lines.push('');
  lines.push(`| | ${fws.map((fw) => frameworks[fw].label).join(' | ')} |`);
  lines.push(rule);
  for (const [key, name] of [['raw', 'raw (minified)'], ['gzip', 'gzip -9'], ['brotli', 'brotli q11']]) {
    lines.push(`| ${name} | ${fws.map((fw) => kb(frameworks[fw].bundle[key])).join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('Standard js-framework-benchmark keyed operations. Each op: unmeasured prep,');
  lines.push('then one measured `click()`, timed in-page from just before the synchronous');
  lines.push('click dispatch. **total** stops in a double `requestAnimationFrame` after it');
  lines.push('(script + style + layout + frame commit). **script only** stops as soon as');
  lines.push('the click task and all microtasks it queued have run (a MessageChannel');
  lines.push('message posted right after the click, or the next frame if the browser renders');
  lines.push('first), before style and layout. Both come from the same click. DOM state is');
  lines.push('asserted at the script stop point and again after the frame, on every sample.');
  lines.push('Throttled tables apply `Emulation.setCPUThrottlingRate` (CDP) around each');
  lines.push('measured click only; prep runs unthrottled.');
  lines.push('');
  lines.push('## Caveats — read before quoting these numbers');
  lines.push('');
  lines.push('- This is NOT the official js-framework-benchmark harness: in-page timing');
  lines.push('  instead of CDP timeline tracing (excludes raster/composite), one uniform');
  lines.push('  throttle rate for every op (the official harness picks 1x-16x per op), and');
  lines.push('  far fewer samples. Use it for relative ordering, not cross-publication');
  lines.push('  comparison.');
  lines.push('- The double-rAF total carries a frame-scheduling floor of roughly 8-10ms on');
  lines.push('  every op, identical for all frameworks, which compresses cheap-op ratios');
  lines.push('  toward 1. The script-only table has no frame floor: use it to compare');
  lines.push('  framework work on select/swap/remove/update, where totals are mostly floor.');
  lines.push('- Script-only excludes style recalculation, layout and paint, which the');
  lines.push('  framework does not control directly but does cause (e.g. by touching more');
  lines.push('  nodes than needed). Read it together with the total, never instead of it.');
  lines.push('- Script-only is at the 5us resolution of a cross-origin-isolated page;');
  lines.push('  sub-0.1ms values and their vs-vanilla ratios (floored at 0.05ms) are noisy.');
  lines.push('  `stoppedByFrame` in results.json counts samples where the browser rendered');
  lines.push('  before the probe message arrived (the clock then stopped at the frame).');
  lines.push('- CDP CPU throttling does not slow sub-millisecond work evenly (vanilla');
  lines.push('  select/swap script times barely change at 4x): throttled script times are');
  lines.push('  meaningful for ops that take milliseconds, noisy for the cheapest ones.');
  lines.push('- Vanilla and Solid 1.9 finish synchronously inside the click; React 19 and');
  lines.push('  Solid 2.0 flush in a microtask; what flushes synchronously at the end of');
  lines.push('  `batch()` (create/replace/update/clear) and in a microtask after a bare');
  lines.push('  signal write (select/swap/remove/append). Every framework\'s DOM was verified');
  lines.push('  complete at the script stop point; one that deferred to a timer or a later');
  lines.push('  frame would fail the run rather than report a short time.');
  lines.push('- Headless Chromium; headed numbers differ slightly.');
  lines.push('- `what` is built from the repo working tree (not the published npm package).');
  lines.push('- All frameworks are bundled by the same vite + esbuild minifier; Solid\'s');
  lines.push('  official entries use rollup + terser, so absolute sizes differ from theirs.');
  lines.push('- Implementations follow each framework\'s official krausest entry idioms');
  lines.push('  (React: memo + immutable updates; Solid 1.9: createSelector; Solid 2.0:');
  lines.push('  selection store, automatic microtask batching; what: per-row label signals)');
  lines.push('  with this harness\'s shared markup.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const SAMPLES = opts.quick ? 3 : 10;
  const SAMPLES_HEAVY = opts.quick ? 2 : 5; // 10k-row ops
  const startedAt = Date.now();

  const frameworks = {};
  const runs = [];
  let chromiumVersion;
  try {
    for (const fw of opts.frameworks) {
      const packages = await bundledPackages(fw);
      verifyBundledPackages(fw, packages);
      frameworks[fw] = {
        label: FRAMEWORK_LABELS[fw],
        packages: (packages ?? []).filter((p) => !p.name.startsWith('what-krausest')),
        bundle: await bundleSizes(fw),
      };
    }
    for (const throttle of opts.throttle) {
      const run = await runFrameworks(opts.frameworks, {
        samples: SAMPLES,
        samplesHeavy: SAMPLES_HEAVY,
        warmup: opts.quick ? 1 : null,
        log: true,
        throttle,
        scriptMetric: true,
      });
      chromiumVersion = run.chromiumVersion;
      runs.push({ throttle, results: run.results });
    }
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }

  let gitRev = 'unknown';
  try { gitRev = execSync('git rev-parse --short HEAD', { cwd: here, encoding: 'utf8' }).trim(); } catch {}

  const meta = {
    date: new Date().toISOString(),
    quick: opts.quick,
    samplesPerOp: SAMPLES,
    samplesHeavy: SAMPLES_HEAVY,
    throttleRates: opts.throttle,
    durationSec: Math.round((Date.now() - startedAt) / 1000),
    node: process.version,
    chromium: chromiumVersion,
    gitRev,
    machine: {
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpu: os.cpus()[0]?.model || 'unknown',
      cores: os.cpus().length,
      memGB: Math.round(os.totalmem() / 1e9),
    },
  };

  await writeFile(path.join(here, 'results.json'), JSON.stringify({ meta, frameworks, runs }, null, 2) + '\n');
  await writeFile(path.join(here, 'RESULTS.md'), renderResults({ meta, frameworks, runs }));
  console.log(`\nWrote results.json and RESULTS.md (${meta.durationSec}s)`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
