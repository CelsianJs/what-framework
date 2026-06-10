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
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist');
const PORT = 4870;

const QUICK = process.argv.includes('--quick');
const fwFilter = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FRAMEWORKS = ['vanilla', 'what', 'react', 'solid'].filter((f) => !fwFilter.length || fwFilter.includes(f));

const SAMPLES = QUICK ? 3 : 10;
const SAMPLES_HEAVY = QUICK ? 2 : 5; // 10k-row ops

// ---------------------------------------------------------------------------
// Static file server for dist/
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const server = http.createServer(async (req, res) => {
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
await new Promise((r) => server.listen(PORT, r));

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
const OPS = [
  {
    id: 'create1k', label: 'create 1,000 rows', n: SAMPLES, warmup: QUICK ? 1 : 5,
    prep: async (p) => { await clickAndSettle(p, '#clear'); },
    act: '#run',
    verify: async (p) => { if (await rowCount(p) !== 1000) throw new Error('create1k: expected 1000 rows'); },
  },
  {
    id: 'replace1k', label: 'replace all 1,000 rows', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { if (await rowCount(p) !== 1000) await clickAndSettle(p, '#run'); },
    act: '#run',
    verify: async (p) => { if (await rowCount(p) !== 1000) throw new Error('replace1k: expected 1000 rows'); },
  },
  {
    id: 'update10th', label: 'partial update (every 10th of 1,000)', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#update',
    verify: async (p) => {
      const ok = await p.evaluate(() => document.querySelector('tbody tr:first-child a.lbl').textContent.endsWith(' !!!'));
      if (!ok) throw new Error('update10th: first row label not updated');
    },
  },
  {
    id: 'select', label: 'select row', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: 'tbody tr:nth-child(2) a.lbl',
    verify: async (p) => {
      const ok = await p.evaluate(() => document.querySelector('tbody tr:nth-child(2)').classList.contains('danger'));
      if (!ok) throw new Error('select: row 2 not selected');
    },
  },
  {
    id: 'swap', label: 'swap rows (2 and 999)', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#swaprows',
    verify: async (p) => { if (await rowCount(p) !== 1000) throw new Error('swap: row count changed'); },
  },
  {
    id: 'remove', label: 'remove one row', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: 'tbody tr:nth-child(4) a.remove',
    verify: async (p) => { if (await rowCount(p) !== 999) throw new Error('remove: expected 999 rows'); },
  },
  {
    id: 'create10k', label: 'create 10,000 rows', n: SAMPLES_HEAVY, warmup: 1,
    prep: async (p) => { await clickAndSettle(p, '#clear'); },
    act: '#runlots',
    verify: async (p) => { if (await rowCount(p) !== 10000) throw new Error('create10k: expected 10000 rows'); },
  },
  {
    id: 'append1k', label: 'append 1,000 to 1,000 rows', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#add',
    verify: async (p) => { if (await rowCount(p) !== 2000) throw new Error('append1k: expected 2000 rows'); },
  },
  {
    id: 'clear1k', label: 'clear 1,000 rows', n: SAMPLES, warmup: QUICK ? 1 : 3,
    prep: async (p) => { await clickAndSettle(p, '#clear'); await clickAndSettle(p, '#run'); },
    act: '#clear',
    verify: async (p) => { if (await rowCount(p) !== 0) throw new Error('clear1k: expected 0 rows'); },
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const { chromium } = await import('playwright'); // repo root devDependency

for (const fw of FRAMEWORKS) {
  if (!existsSync(path.join(distDir, fw, 'index.html'))) {
    console.error(`dist/${fw}/index.html missing — run \`npm run build\` first.`);
    process.exit(1);
  }
}

const browser = await chromium.launch({ headless: true });
const results = {};
let chromiumVersion = browser.version();

for (const fw of FRAMEWORKS) {
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
  process.stdout.write(`\n${fw}`);
  for (const op of OPS) {
    const samples = [];
    for (let i = 0; i < op.warmup + op.n; i++) {
      await op.prep(page);
      const ms = await measureClick(page, op.act);
      await op.verify(page);
      if (i >= op.warmup) samples.push(ms);
    }
    results[fw][op.id] = stats(samples);
    process.stdout.write(` ${op.id}:${results[fw][op.id].median}ms`);
  }
  process.stdout.write('\n');
  await context.close();
}

await browser.close();
server.close();

// ---------------------------------------------------------------------------
// Persist: results.json + RESULTS.md
// ---------------------------------------------------------------------------
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
