#!/usr/bin/env node
// js-framework-benchmark (krausest) style driver.
//
// Methodology (documented in README.md, caveats in RESULTS.md):
//   - Serves the vite production builds from dist/ on port 4870 (Track D range).
//   - Chromium via Playwright (resolved from the repo root's devDependency),
//     headless, one fresh page per framework.
//   - Each operation: prep steps (not measured), then ONE measured click.
//     Timing = performance.now() before the synchronous click() dispatch to a
//     double requestAnimationFrame after it — i.e. script + style + layout +
//     the frame the browser commits after the work ("action -> paint-settle").
//     This is an in-page approximation of krausest's CDP-timeline metric; it
//     EXCLUDES raster/composite, and no CPU slowdown is applied (the official
//     benchmark runs some ops at 4x-16x CPU throttle).
//   - Warmup iterations are discarded; the table reports the MEDIAN of the
//     measured samples (mean/min/stddev are kept in results.json).
//   - Every measured op is verified against the DOM afterwards (row counts,
//     selection class, label suffix) so a framework can't "win" by skipping work.
//
// Usage:  node bench.mjs [--quick] [framework ...]

import http from 'node:http';
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist');
const PORT = 4870;

export const ALL_FRAMEWORKS = ['vanilla', 'what', 'react', 'solid'];

// ---------------------------------------------------------------------------
// Static file server for dist/
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let filePath = path.normalize(path.join(distDir, urlPath));
      if (!filePath.startsWith(distDir)) { res.writeHead(403); return res.end(); }
      if (filePath.endsWith(path.sep) || !path.extname(filePath)) filePath = path.join(filePath, 'index.html');
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
}

// ---------------------------------------------------------------------------
// In-page measurement: synchronous click -> double rAF
// ---------------------------------------------------------------------------
async function measureClick(page, selector) {
  return page.evaluate((sel) => new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    if (!el) return reject(new Error(`no element: ${sel}`));
    const start = performance.now();
    el.click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
  }), selector);
}

async function clickAndSettle(page, selector) {
  await measureClick(page, selector); // unmeasured prep click, still waits for the frame
}

async function rowCount(page) {
  return page.evaluate(() => document.querySelectorAll('tbody tr').length);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const stddev = Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length);
  return {
    median: +median.toFixed(2),
    mean: +mean.toFixed(2),
    min: +sorted[0].toFixed(2),
    stddev: +stddev.toFixed(2),
    samples: samples.map((v) => +v.toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// Operations — prep is unmeasured, `act` is the measured click, `verify`
// asserts the DOM did what the op claims.
// ---------------------------------------------------------------------------
export const OPS = [
  {
    id: 'create1k', label: 'create 1,000 rows', warmup: 5,
    prep: async (p) => { await clickAndSettle(p, '#clear'); },
    act: '#run',
    verify: async (p) => { if (await rowCount(p) !== 1000) throw new Error('create1k: expected 1000 rows'); },
  },
  {
    id: 'replace1k', label: 'replace all 1,000 rows', warmup: 3,
    prep: async (p) => { if (await rowCount(p) !== 1000) await clickAndSettle(p, '#run'); },
    act: '#run',
    verify: async (p) => { if (await rowCount(p) !== 1000) throw new Error('replace1k: expected 1000 rows'); },
  },
  {
    id: 'update10th', label: 'partial update (every 10th of 1,000)', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#update',
    verify: async (p) => {
      const ok = await p.evaluate(() => document.querySelector('tbody tr:first-child a.lbl').textContent.endsWith(' !!!'));
      if (!ok) throw new Error('update10th: first row label not updated');
    },
  },
  {
    id: 'select', label: 'select row', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: 'tbody tr:nth-child(2) a.lbl',
    verify: async (p) => {
      const ok = await p.evaluate(() => document.querySelector('tbody tr:nth-child(2)').classList.contains('danger'));
      if (!ok) throw new Error('select: row 2 not selected');
    },
  },
  {
    id: 'swap', label: 'swap rows (2 and 999)', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#swaprows',
    verify: async (p) => { if (await rowCount(p) !== 1000) throw new Error('swap: row count changed'); },
  },
  {
    id: 'remove', label: 'remove one row', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: 'tbody tr:nth-child(4) a.remove',
    verify: async (p) => { if (await rowCount(p) !== 999) throw new Error('remove: expected 999 rows'); },
  },
  {
    id: 'create10k', label: 'create 10,000 rows', warmup: 1, heavy: true,
    prep: async (p) => { await clickAndSettle(p, '#clear'); },
    act: '#runlots',
    verify: async (p) => { if (await rowCount(p) !== 10000) throw new Error('create10k: expected 10000 rows'); },
  },
  {
    id: 'append1k', label: 'append 1,000 to 1,000 rows', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#add',
    verify: async (p) => { if (await rowCount(p) !== 2000) throw new Error('append1k: expected 2000 rows'); },
  },
  {
    id: 'clear1k', label: 'clear 1,000 rows', warmup: 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#clear',
    verify: async (p) => { if (await rowCount(p) !== 0) throw new Error('clear1k: expected 0 rows'); },
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
export async function runFrameworks(frameworks, { samples = 10, samplesHeavy = 5, warmup = null, log = false } = {}) {
  for (const fw of frameworks) {
    if (!existsSync(path.join(distDir, fw, 'index.html'))) {
      throw new Error(`dist/${fw}/index.html missing: run \`npm run build\` in benchmark/krausest first.`);
    }
  }

  const { chromium } = await import('playwright'); // repo root devDependency
  const server = createServer();
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const chromiumVersion = browser.version();
  const results = {};

  try {
    for (const fw of frameworks) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/${fw}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#run');
      // JS bundle size (gzip not applied; raw bytes of all dist js assets)
      const bundleBytes = await page.evaluate(async () => {
        const entries = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js'));
        return entries.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0);
      });

      results[fw] = { bundleBytes };
      if (log) process.stdout.write(`\n${fw}`);
      for (const op of OPS) {
        const n = op.heavy ? samplesHeavy : samples;
        const w = warmup === null ? op.warmup : warmup;
        const measured = [];
        for (let i = 0; i < w + n; i++) {
          await op.prep(page);
          const ms = await measureClick(page, op.act);
          await op.verify(page);
          if (i >= w) measured.push(ms);
        }
        results[fw][op.id] = stats(measured);
        if (log) process.stdout.write(` ${op.id}:${results[fw][op.id].median}ms`);
      }
      if (log) process.stdout.write('\n');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  return { results, chromiumVersion };
}

export async function runWhat({ samples = 10, samplesHeavy = 5 } = {}) {
  const { results } = await runFrameworks(['what'], { samples, samplesHeavy });
  return results.what;
}

// ---------------------------------------------------------------------------
// Persist: results.json + RESULTS.md
// ---------------------------------------------------------------------------
async function main() {
  const QUICK = process.argv.includes('--quick');
  const fwFilter = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const FRAMEWORKS = ALL_FRAMEWORKS.filter((f) => !fwFilter.length || fwFilter.includes(f));

  const SAMPLES = QUICK ? 3 : 10;
  const SAMPLES_HEAVY = QUICK ? 2 : 5; // 10k-row ops

  let run;
  try {
    run = await runFrameworks(FRAMEWORKS, {
      samples: SAMPLES,
      samplesHeavy: SAMPLES_HEAVY,
      warmup: QUICK ? 1 : null,
      log: true,
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { results, chromiumVersion } = run;

  let gitRev = 'unknown';
  try { gitRev = execSync('git rev-parse --short HEAD', { cwd: here, encoding: 'utf8' }).trim(); } catch {}

  const meta = {
    date: new Date().toISOString(),
    quick: QUICK,
    samplesPerOp: SAMPLES,
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

  await writeFile(path.join(here, 'results.json'), JSON.stringify({ meta, results }, null, 2));

  const fwCols = FRAMEWORKS;
  const geo = {};
  for (const fw of fwCols) {
    if (!results.vanilla || fw === 'vanilla') { geo[fw] = 1; continue; }
    const ratios = OPS.map((op) => results[fw][op.id].median / Math.max(results.vanilla[op.id].median, 0.05));
    geo[fw] = +Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length).toFixed(2);
  }

  const lines = [];
  lines.push('# krausest-style keyed benchmark — results');
  lines.push('');
  lines.push(`Generated by \`bench.mjs\` on ${meta.date} (git ${gitRev}${QUICK ? ', QUICK mode — fewer samples' : ''}).`);
  lines.push('');
  lines.push(`- **Machine:** ${meta.machine.cpu} (${meta.machine.cores} cores, ${meta.machine.memGB} GB), ${meta.machine.platform} ${meta.machine.arch}`);
  lines.push(`- **Browser:** Chromium ${meta.chromium} (Playwright, headless) — Node ${meta.node}`);
  lines.push(`- **Samples:** median of ${SAMPLES} (heavy ops: ${SAMPLES_HEAVY}) after warmup; all numbers in ms.`);
  lines.push('');
  lines.push(`| operation | ${fwCols.join(' | ')} |`);
  lines.push(`|---|${fwCols.map(() => '---:').join('|')}|`);
  for (const op of OPS) {
    lines.push(`| ${op.label} | ${fwCols.map((fw) => `${results[fw][op.id].median} ±${results[fw][op.id].stddev}`).join(' | ')} |`);
  }
  lines.push(`| **geometric mean (vs vanilla)** | ${fwCols.map((fw) => `**${geo[fw]}**`).join(' | ')} |`);
  lines.push(`| js bundle (raw, kB) | ${fwCols.map((fw) => (results[fw].bundleBytes / 1024).toFixed(1)).join(' | ')} |`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('Standard js-framework-benchmark keyed operations. Each op: unmeasured prep,');
  lines.push('then one measured `click()` — timed in-page from before the synchronous click');
  lines.push('dispatch to a double `requestAnimationFrame` after it (script + style + layout +');
  lines.push('frame commit). DOM state is asserted after every measured action.');
  lines.push('');
  lines.push('## Caveats — read before quoting these numbers');
  lines.push('');
  lines.push('- This is NOT the official js-framework-benchmark harness: no CPU throttling');
  lines.push('  (official runs several ops at 4x-16x slowdown), in-page double-rAF timing');
  lines.push('  instead of CDP timeline tracing (excludes raster/composite), and far fewer');
  lines.push('  samples. Use it for relative ordering, not for cross-publication comparison.');
  lines.push('- Headless Chromium; headed numbers differ slightly.');
  lines.push('- `what` is built from the repo working tree (not the published npm package).');
  lines.push('- The double-rAF wait imposes a frame-scheduling floor of roughly 8-10ms on');
  lines.push('  every op (visible on select/swap/remove, whose script cost is <1ms). The');
  lines.push('  floor is identical for all frameworks, but it compresses the vs-vanilla');
  lines.push('  ratios on cheap ops toward 1 — treat differences under ~2ms as noise.');
  lines.push('- Implementations follow each framework\'s official krausest entry idioms');
  lines.push('  (React: memo + immutable updates; Solid/What: per-row label signals).');
  lines.push('');
  await writeFile(path.join(here, 'RESULTS.md'), lines.join('\n'));

  console.log('\nWrote results.json and RESULTS.md');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
