/**
 * What Framework - Browser Benchmark Runner
 * Runs js-framework-benchmark on both vanilla JS and What Framework.
 * Uses sync timing to measure framework overhead directly.
 * Usage: node benchmark/run-browser.js
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function createServer() {
  return http.createServer((req, res) => {
    let filePath = path.join(ROOT, req.url === '/' ? '/benchmark/src/index.html' : req.url);
    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}

const OPS_WHAT = {
  'create 1k':     { setup: `_bench.clear(); _bench.flushSync();`, action: `_bench.run(); _bench.flushSync();` },
  'replace 1k':    { setup: `_bench.run(); _bench.flushSync();`, action: `_bench.run(); _bench.flushSync();` },
  'update 10th':   { setup: `_bench.run(); _bench.flushSync();`, action: `_bench.update(); _bench.flushSync();` },
  'select row':    { setup: `_bench.run(); _bench.flushSync();`, action: `var d=_bench.data(); _bench.selectRow(d[d.length>>1].id); _bench.flushSync();` },
  'swap rows':     { setup: `_bench.run(); _bench.flushSync();`, action: `_bench.swapRows(); _bench.flushSync();` },
  'remove row':    { setup: `_bench.run(); _bench.flushSync();`, action: `var d=_bench.data(); _bench.remove(d[0].id); _bench.flushSync();` },
  'create 10k':    { setup: `_bench.clear(); _bench.flushSync();`, action: `_bench.runLots(); _bench.flushSync();`, runs: 5 },
  'append 1k':     { setup: `_bench.run(); _bench.flushSync();`, action: `_bench.add(); _bench.flushSync();` },
  'clear 1k':      { setup: `_bench.run(); _bench.flushSync();`, action: `_bench.clear(); _bench.flushSync();` },
};

const OPS_VANILLA = {
  'create 1k':     { setup: `_bench.clear();`, action: `_bench.run();` },
  'replace 1k':    { setup: `_bench.run();`, action: `_bench.run();` },
  'update 10th':   { setup: `_bench.run();`, action: `_bench.update();` },
  'select row':    { setup: `_bench.run();`, action: `var d=_bench.getData(); _bench.selectRow(d[d.length>>1].id);` },
  'swap rows':     { setup: `_bench.run();`, action: `_bench.swapRows();` },
  'remove row':    { setup: `_bench.run();`, action: `var d=_bench.getData(); _bench.remove(d[0].id);` },
  'create 10k':    { setup: `_bench.clear();`, action: `_bench.runLots();`, runs: 5 },
  'append 1k':     { setup: `_bench.run();`, action: `_bench.add();` },
  'clear 1k':      { setup: `_bench.run();`, action: `_bench.clear();` },
};

// The js-framework-benchmark measures with paint time included.
// These are typical durations from the official benchmark for vanilla JS on mid-range hardware.
// We use these as reference when vanilla sync time is too fast to measure.
const JFB_VANILLA_REF = {
  'create 1k': 38,   'replace 1k': 42,  'update 10th': 15,
  'select row': 1.5, 'swap rows': 1.2,  'remove row': 15,
  'create 10k': 380, 'append 1k': 38,   'clear 1k': 11,
};

async function benchmarkPage(page, ops) {
  const WARMUP = 5;
  const DEFAULT_RUNS = 20;
  const results = {};

  for (const [name, op] of Object.entries(ops)) {
    const runs = op.runs || DEFAULT_RUNS;
    const times = [];

    for (let i = 0; i < WARMUP; i++) {
      await page.evaluate(`(function(){ var _bench=window._bench; ${op.setup} })()`);
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(`(function(){ var _bench=window._bench; ${op.action} })()`);
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    }

    for (let i = 0; i < runs; i++) {
      await page.evaluate(`(function(){ var _bench=window._bench; ${op.setup} })()`);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

      const time = await page.evaluate((actionCode) => {
        const start = performance.now();
        (0, eval)(actionCode);
        return performance.now() - start;
      }, `(function(){ var _bench=window._bench; ${op.action} })()`);

      times.push(time);
    }

    times.sort((a, b) => a - b);
    const lo = Math.floor(times.length * 0.2);
    const hi = Math.ceil(times.length * 0.8);
    const trimmed = times.slice(lo, hi);
    const median = trimmed[Math.floor(trimmed.length / 2)];
    results[name] = { median, min: times[0], max: times[times.length - 1] };
  }
  return results;
}

async function main() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  console.log('\n  Benchmarking Vanilla JS...');
  const vp = await browser.newPage();
  await vp.goto(`http://localhost:${port}/benchmark/src/vanilla.html`);
  await vp.waitForSelector('#run');
  await vp.waitForTimeout(500);
  const vr = await benchmarkPage(vp, OPS_VANILLA);
  await vp.close();

  console.log('  Benchmarking What Framework...\n');
  const wp = await browser.newPage();
  await wp.goto(`http://localhost:${port}/benchmark/src/index.html`);
  await wp.waitForSelector('#run');
  await wp.waitForTimeout(500);
  const wr = await benchmarkPage(wp, OPS_WHAT);
  await wp.close();

  // --- Results ---
  console.log('  What Framework vs Vanilla JS — Benchmark Results');
  console.log('  ' + '='.repeat(72));
  console.log('');
  console.log(`  ${'Operation'.padEnd(16)} ${'Vanilla'.padStart(10)} ${'What FW'.padStart(10)} ${'Overhead'.padStart(10)} ${'Comment'.padStart(24)}`);
  console.log('  ' + '-'.repeat(72));

  const opNames = Object.keys(OPS_WHAT);
  const analysis = [];

  for (const name of opNames) {
    const v = vr[name], w = wr[name];
    const overhead = w.median - v.median;

    const vStr = v.median < 0.5 ? '<0.5ms' : v.median.toFixed(1) + 'ms';
    const wStr = w.median.toFixed(1) + 'ms';
    const oStr = (overhead >= 0 ? '+' : '') + overhead.toFixed(1) + 'ms';

    let comment = '';
    if (overhead < 1) comment = 'excellent';
    else if (overhead < 3) comment = 'good';
    else if (overhead < 8) comment = 'full re-render cost';
    else comment = 'needs optimization';

    analysis.push({ name, vanilla: v.median, what: w.median, overhead, comment });
    console.log(`  ${name.padEnd(16)} ${vStr.padStart(10)} ${wStr.padStart(10)} ${oStr.padStart(10)} ${comment.padStart(24)}`);
  }

  // Estimate realistic js-framework-benchmark score
  // The official benchmark includes paint time. For creation ops, our measurements are close.
  // For partial updates, the paint time is small (1-2ms), so the overhead is real.
  console.log('\n  ' + '='.repeat(72));
  console.log('\n  Analysis\n');

  // Group by category
  const creation = analysis.filter(a => a.name.includes('create') || a.name.includes('replace') || a.name.includes('append'));
  const partialUpdate = analysis.filter(a => ['update 10th', 'select row', 'swap rows', 'remove row'].includes(a.name));
  const cleanup = analysis.filter(a => a.name.includes('clear'));

  const avgCreationOverhead = creation.reduce((s, a) => s + a.what / Math.max(a.vanilla, 0.1), 0) / creation.length;
  const avgPartialOverhead = partialUpdate.reduce((s, a) => s + a.what / Math.max(a.vanilla, 0.1), 0) / partialUpdate.length;

  console.log(`  Creation ops (create/replace/append):     ~${avgCreationOverhead.toFixed(1)}x overhead`);
  console.log(`  Partial updates (update/select/swap/rm):  ~${avgPartialOverhead.toFixed(1)}x overhead`);
  console.log(`  Cleanup (clear):                          ~${(cleanup[0].what / Math.max(cleanup[0].vanilla, 0.1)).toFixed(1)}x overhead`);
  console.log('');

  // Calculate estimated jfb score using reference vanilla times
  let jfbGeoSum = 0, jfbCount = 0;
  for (const a of analysis) {
    const ref = JFB_VANILLA_REF[a.name];
    // Estimated jfb time = vanilla_ref + our_overhead
    const estimated = ref + a.overhead;
    const ratio = estimated / ref;
    jfbGeoSum += Math.log(ratio);
    jfbCount++;
  }
  const jfbGeoMean = Math.exp(jfbGeoSum / jfbCount);

  console.log(`  Estimated js-framework-benchmark score: ~${jfbGeoMean.toFixed(2)}x`);
  console.log('');
  console.log('  Published scores for reference:');
  console.log('    vanillajs     1.03x  (baseline)');
  console.log('    solid v1.9    1.11x');
  console.log('    svelte v5     1.13x');
  console.log('    preact v10    1.24x');
  console.log('    vue v3.6      1.29x');
  console.log('    react v19     1.54x');
  console.log('    angular v19   1.52x');
  console.log('');

  console.log('  Root cause of partial update overhead:');
  console.log('    When ANY signal changes, the entire App component re-renders.');
  console.log('    signal.set() -> App effect re-runs -> creates ALL 1000 vnodes -> reconciles ALL rows');
  console.log('    Even to change 1 class on 1 row, we rebuild the entire vnode tree.');
  console.log('    This is the same issue React has without memo/useMemo.');
  console.log('');

  // Correctness
  const cp = await browser.newPage();
  await cp.goto(`http://localhost:${port}/benchmark/src/index.html`);
  await cp.waitForSelector('#run');
  await cp.waitForTimeout(300);
  const checks = await cp.evaluate(() => {
    const b = window._bench, r = [];
    b.clear(); b.flushSync(); b.run(); b.flushSync();
    const t = document.getElementById('tbody');
    r.push({ n: 'Create 1000', p: t.querySelectorAll('tr').length === 1000 });
    const d = b.data(); b.selectRow(d[5].id); b.flushSync();
    r.push({ n: 'Select', p: !!t.querySelector('tr.danger') });
    const x = t.children[1]?.querySelector('td')?.textContent;
    const y = t.children[998]?.querySelector('td')?.textContent;
    b.swapRows(); b.flushSync();
    r.push({ n: 'Swap', p: t.children[1]?.querySelector('td')?.textContent === y && t.children[998]?.querySelector('td')?.textContent === x });
    b.clear(); b.flushSync();
    r.push({ n: 'Clear', p: t.querySelectorAll('tr').length === 0 });
    return r;
  });
  console.log('  Correctness: ' + (checks.every(c => c.p) ? 'ALL PASS' : checks.filter(c => !c.p).map(c => c.n + ' FAIL').join(', ')));
  console.log('');

  await cp.close();
  await browser.close();
  server.close();
}

main().catch(err => { console.error('Benchmark failed:', err); process.exit(1); });
