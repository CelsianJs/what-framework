#!/usr/bin/env node
// Server-rendering benchmark driver: what (vnode renderer and compiled) vs
// solid 1.9 vs solid 2.0 vs react 19.
//
// Methodology (README.md has the short version, RESULTS.md the caveats):
//   - Workload: the krausest table page (benchmark/krausest/frameworks/*), the
//     same markup on every framework, 1,000 and 10,000 rows from one seeded
//     dataset (shared/data.mjs).
//   - Bundles come from build.mjs: each framework's JSX compiled by its own
//     compiler in its own server mode, NODE_ENV=production.
//   - Every measurement is one job in a FRESH Node process (worker.mjs), so no
//     framework inherits another's JIT state, heap or GC pressure. Jobs run
//     strictly one at a time. A full run repeats every timing job in 3 rounds,
//     rotating the framework order each round, and pools the samples; the
//     spread of the per-round medians is reported as a noise indicator.
//   - Before any timing, each job renders once and asserts row count, specific
//     cell text, the selected row, and structural equality with the canonical
//     markup after stripping hydration markers (shared/verify.mjs). The checker
//     itself is self-tested first against deliberately broken markup.
//   - string: render + UTF-8 encode, timed per call after warmup; median, p95,
//     ops/s = 1000 / median.
//   - stream / streamAsync: hydratable bundles (streaming exists to hydrate;
//     every framework streams hydratable HTML). Consumed in-process by a
//     recording Writable.
//   - cards: string render of the component page (CARD_COUNT small
//     components, shared/data.mjs buildCards), plain and hydratable, with its
//     heap per render (cardsMemory).
//   - memory: heap bytes allocated by one render, measured only when no GC ran
//     during it (worker.mjs explains); one round.
//
// Usage: node bench.mjs [--quick] [framework ...]   (run build.mjs first)

import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRows, expectedPageHtml, SELECTED_ID, CARD_COUNT } from './shared/data.mjs';
import { verifyPage } from './shared/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const ALL_FRAMEWORKS = ['what', 'whatc', 'solid1', 'solid2', 'react'];
const requested = args.filter((a) => !a.startsWith('--'));
const FRAMEWORKS = requested.length ? ALL_FRAMEWORKS.filter((f) => requested.includes(f)) : ALL_FRAMEWORKS;
const MODES = ['plain', 'hydratable'];
const SIZES = [1000, 10000];
const DELAY_MS = 50;
const ROUNDS = QUICK ? 1 : 3;
const SEMI_SPACE_MB = 1024;

// [warmup, samples] per job and round.
const COUNTS = QUICK
  ? { string: { 1000: [30, 40], 10000: [5, 8] }, stream: { 1000: [10, 15], 10000: [2, 4] }, streamAsync: { 1000: [2, 4], 10000: [1, 3] }, memory: { 1000: [10, 5], 10000: [3, 5] }, cards: { [CARD_COUNT]: [30, 40] }, cardsMemory: { [CARD_COUNT]: [10, 5] } }
  : { string: { 1000: [300, 400], 10000: [30, 60] }, stream: { 1000: [50, 100], 10000: [10, 20] }, streamAsync: { 1000: [5, 20], 10000: [3, 10] }, memory: { 1000: [100, 25], 10000: [20, 15] }, cards: { [CARD_COUNT]: [500, 800] }, cardsMemory: { [CARD_COUNT]: [100, 25] } };

const FRAMEWORK_LABEL = { what: 'what h() vnodes (working tree)', whatc: 'what compiled (working tree)', solid1: 'solid 1.9', solid2: 'solid 2.0', react: 'react 19' };
const STRING_API = {
  what: { plain: 'renderToString', hydratable: 'renderToHydratableString' },
  whatc: { plain: 'renderToString, what-compiler generate:"ssr"', hydratable: 'renderToHydratableString, what-compiler generate:"ssr"' },
  solid1: { plain: 'renderToString, compiled hydratable:false', hydratable: 'renderToString, compiled hydratable:true' },
  solid2: { plain: 'renderToString, compiled hydratable:false', hydratable: 'renderToString, compiled hydratable:true' },
  react: { plain: 'renderToStaticMarkup', hydratable: 'renderToString' },
};
const STREAM_API = {
  what: 'renderToStream().pipe (out of order)',
  whatc: 'renderToStream().pipe (out of order)',
  solid1: 'renderToStream().pipe',
  solid2: 'renderToStream().pipe',
  react: 'renderToPipeableStream',
};

function selfTestVerifier() {
  const rows = buildRows(20);
  const good = expectedPageHtml(rows, SELECTED_ID);
  verifyPage(good, rows, SELECTED_ID, good);
  const broken = [
    expectedPageHtml(rows.slice(1), SELECTED_ID),
    good.replace(rows[10].label, 'tampered label'),
    good.replace('class="danger"', 'class=""'),
    good.replace('<td class="col-md-6"></td></tr>', '</tr>'),
    good.replace('aria-hidden="true"', ''),
  ];
  for (const html of broken) {
    let threw = false;
    try { verifyPage(html, rows, SELECTED_ID, good); } catch { threw = true; }
    if (!threw) throw new Error('output verifier accepted broken markup; refusing to benchmark');
  }
}

function runJob(job) {
  const flags = job.op === 'memory' || job.op === 'cardsMemory' ? ['--expose-gc', `--max-semi-space-size=${SEMI_SPACE_MB}`] : [];
  const child = spawnSync(process.execPath, [...flags, path.join(here, 'worker.mjs'), JSON.stringify(job)], {
    cwd: here,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(child.stdout);
  } catch {
    return { ok: false, error: `worker exited ${child.status}: ${child.stderr || child.stdout}`.trim() };
  }
}

function planJobs() {
  const jobs = [];
  for (let round = 0; round < ROUNDS; round++) {
    const order = FRAMEWORKS.map((_, i) => FRAMEWORKS[(i + round) % FRAMEWORKS.length]);
    for (const rows of SIZES) {
      for (const fw of order) {
        for (const mode of MODES) jobs.push({ round, op: 'string', bundle: `${fw}.${mode}`, fw, mode, rows });
        jobs.push({ round, op: 'stream', bundle: `${fw}.hydratable`, fw, mode: 'hydratable', rows });
        jobs.push({ round, op: 'streamAsync', bundle: `${fw}.hydratable`, fw, mode: 'hydratable', rows, delayMs: DELAY_MS });
        if (round === 0) for (const mode of MODES) jobs.push({ round, op: 'memory', bundle: `${fw}.${mode}`, fw, mode, rows });
      }
    }
    for (const fw of order) {
      for (const mode of MODES) jobs.push({ round, op: 'cards', bundle: `${fw}.${mode}`, fw, mode, rows: CARD_COUNT });
      if (round === 0) for (const mode of MODES) jobs.push({ round, op: 'cardsMemory', bundle: `${fw}.${mode}`, fw, mode, rows: CARD_COUNT });
    }
  }
  for (const job of jobs) [job.warmup, job.samples] = COUNTS[job.op][job.rows];
  return jobs;
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, p95: q(0.95), min: s[0], max: s[s.length - 1], mean };
}

// Range of the per-round medians; null with a single round.
function spread(roundMedians) {
  return roundMedians.length > 1 ? Math.max(...roundMedians) - Math.min(...roundMedians) : null;
}

function key(op, fw, mode, rows) {
  return `${op}|${fw}|${mode}|${rows}`;
}

function aggregate(jobs, outputs) {
  const groups = new Map();
  jobs.forEach((job, i) => {
    const k = key(job.op, job.fw, job.mode, job.rows);
    if (!groups.has(k)) groups.set(k, { op: job.op, fw: job.fw, mode: job.mode, rows: job.rows, rounds: [], errors: [] });
    const g = groups.get(k);
    const out = outputs[i];
    if (!out.ok) g.errors.push(out.error);
    else g.rounds.push(out);
  });
  const summary = {};
  for (const [k, g] of groups) {
    const entry = { op: g.op, framework: g.fw, mode: g.mode, rows: g.rows, errors: g.errors };
    if (g.rounds.length) {
      entry.bytes = g.rounds[0].bytes;
      if (g.op === 'string' || g.op === 'cards') {
        entry.ms = stats(g.rounds.flatMap((r) => r.samples));
        entry.renderOnlyMs = stats(g.rounds.flatMap((r) => r.renderOnly));
        entry.roundSpreadMs = spread(g.rounds.map((r) => stats(r.samples).median));
      } else if (g.op === 'memory' || g.op === 'cardsMemory') {
        const samples = g.rounds.flatMap((r) => r.samples);
        entry.discarded = g.rounds.reduce((a, r) => a + r.discarded, 0);
        entry.heapBytes = samples.length ? stats(samples) : null;
      } else {
        const samples = g.rounds.flatMap((r) => r.samples);
        entry.chunks = g.rounds[0].chunks;
        entry.firstChunkMs = stats(samples.map((s) => s.firstChunkMs));
        entry.doneMs = stats(samples.map((s) => s.doneMs));
        entry.roundSpreadMs = spread(g.rounds.map((r) => stats(r.samples.map((s) => s.doneMs)).median));
        if (g.op === 'streamAsync') {
          entry.shellEndMs = stats(samples.map((s) => s.shellEndMs));
          entry.resolvedMs = stats(samples.map((s) => s.resolvedMs));
          entry.fallbackSent = samples.every((s) => s.fallbackSent) ? 'yes' : samples.some((s) => s.fallbackSent) ? 'sometimes' : 'no';
          entry.bytesBeforeResolve = stats(samples.map((s) => s.bytesBeforeResolve)).median;
        }
      }
    }
    summary[k] = entry;
  }
  return summary;
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; }
}

// ---------------------------------------------------------------------------
// RESULTS.md
// ---------------------------------------------------------------------------
const f2 = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const kb = (b) => (b == null ? '—' : `${(b / 1024).toFixed(1)}`);
const mb = (b) => (b == null ? '—' : `${(b / 1048576).toFixed(2)}`);
const int = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));

function errorCell(entry) {
  return entry && entry.errors.length && !entry.ms && !entry.doneMs && !entry.heapBytes ? `FAILED (${entry.errors[0].split('\n')[0].slice(0, 80)})` : null;
}

function stringTable(summary, rows, op = 'string', memoryOp = 'memory') {
  const lines = [
    `| framework | mode | API | median ms | p95 ms | ops/s | time vs solid 2.0, same mode (lower is faster) | render-only median ms | round spread ms | output KB | heap MB / render |`,
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const mode of MODES) {
    const ref = summary[key(op, 'solid2', mode, rows)];
    for (const fw of FRAMEWORKS) {
      const e = summary[key(op, fw, mode, rows)];
      const m = summary[key(memoryOp, fw, mode, rows)];
      const failed = errorCell(e);
      if (failed) { lines.push(`| ${FRAMEWORK_LABEL[fw]} | ${mode} | ${STRING_API[fw][mode]} | ${failed} |||||||| `); continue; }
      const ratio = ref && ref.ms ? `${(e.ms.median / ref.ms.median).toFixed(2)}x` : '—';
      const heap = m && m.heapBytes ? mb(m.heapBytes.median) + (m.discarded ? ` (${m.discarded} discarded)` : '') : m && m.errors.length ? 'failed' : 'n/a';
      lines.push(`| ${FRAMEWORK_LABEL[fw]} | ${mode} | ${STRING_API[fw][mode]} | ${f2(e.ms.median)} | ${f2(e.ms.p95)} | ${int(1000 / e.ms.median)} | ${ratio} | ${f2(e.renderOnlyMs.median)} | ${f2(e.roundSpreadMs)} | ${kb(e.bytes)} | ${heap} |`);
    }
  }
  return lines;
}

function streamTable(summary, rows) {
  const lines = [
    '| framework | API | first chunk ms (median) | done ms (median) | done p95 | round spread ms | chunks | KB |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const fw of FRAMEWORKS) {
    const e = summary[key('stream', fw, 'hydratable', rows)];
    const failed = errorCell(e);
    if (failed) { lines.push(`| ${FRAMEWORK_LABEL[fw]} | ${STREAM_API[fw]} | ${failed} |||||| `); continue; }
    lines.push(`| ${FRAMEWORK_LABEL[fw]} | ${STREAM_API[fw]} | ${f2(e.firstChunkMs.median)} | ${f2(e.doneMs.median)} | ${f2(e.doneMs.p95)} | ${f2(e.roundSpreadMs)} | ${int(e.chunks)} | ${kb(e.bytes)} |`);
  }
  return lines;
}

function asyncTable(summary, rows) {
  const lines = [
    `| framework | first chunk ms | shell end (footer) ms | fallback flushed before data | KB sent before data | data resolved ms | done ms | done − resolved ms | chunks | KB total |`,
    '|---|---:|---:|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const fw of FRAMEWORKS) {
    const e = summary[key('streamAsync', fw, 'hydratable', rows)];
    const failed = errorCell(e);
    if (failed) { lines.push(`| ${FRAMEWORK_LABEL[fw]} | ${failed} ||||||||| `); continue; }
    lines.push(`| ${FRAMEWORK_LABEL[fw]} | ${f2(e.firstChunkMs.median)} | ${f2(e.shellEndMs.median)} | ${e.fallbackSent} | ${kb(e.bytesBeforeResolve)} | ${f2(e.resolvedMs.median)} | ${f2(e.doneMs.median)} | ${f2(e.doneMs.median - e.resolvedMs.median)} | ${int(e.chunks)} | ${kb(e.bytes)} |`);
  }
  return lines;
}

function renderMarkdown(meta, summary) {
  const L = [];
  L.push('# SSR benchmark — results', '');
  if (QUICK) {
    L.push('> **SMOKE RUN (`--quick`).** Few samples, one round, and taken while other',
      '> benchmarks were loading this machine. These numbers only prove the harness',
      '> works end to end. Do not quote them; the official run overwrites this file.', '');
  }
  L.push(`Generated by \`bench.mjs${QUICK ? ' --quick' : ''}\` on ${meta.date} (git ${meta.git.commit}${meta.git.whatDirtyFiles ? `, ${meta.git.whatDirtyFiles} uncommitted file(s) in the what sources bundled` : ''}).`, '');
  L.push(`- **Machine:** ${meta.machine.cpu} (${meta.machine.cores} cores, ${meta.machine.memGB} GB), ${meta.machine.platform} ${meta.machine.arch}, load average at start ${meta.machine.loadavg.join(' / ')}`);
  L.push(`- **Runtime:** Node ${meta.node} (V8 ${meta.v8}), NODE_ENV=production, one fresh process per job`);
  L.push(`- **Packages (from the bundles):** ${meta.versions}`);
  L.push(`- **Samples:** ${ROUNDS} round(s); per round and job [warmup, samples] = ${JSON.stringify(COUNTS)}`);
  L.push(`- **Async boundary delay:** ${DELAY_MS} ms`, '');

  for (const rows of SIZES) {
    L.push(`## Synchronous string render — ${rows.toLocaleString('en-US')} rows`, '');
    L.push(...stringTable(summary, rows), '');
  }
  L.push('"plain" is each framework\'s non-hydratable string render; "hydratable" adds',
    'what the client needs to hydrate (What `data-hk` + comment markers, Solid `data-hk`/`_hk` +',
    'comments; React\'s renderToString differs from renderToStaticMarkup only by `<!-- -->` text',
    'separators, none of which this page needs). Times include UTF-8 encoding of the result;',
    '"render-only" excludes it. Heap MB is allocation during one render with no GC in between',
    '(n/a when every sample saw a GC).', '');

  L.push(`## Synchronous string render — component page, ${CARD_COUNT} components`, '');
  L.push(...stringTable(summary, CARD_COUNT, 'cards', 'cardsMemory'), '');
  L.push(`${CARD_COUNT} small components in a keyed list (\`shared/data.mjs\` buildCards, \`frameworks/*/cards.jsx\`):`,
    'each a card with fixed text, text from its props and a counter of its own shown in a',
    'button. The table page has three components; this one measures what a component costs.', '');

  for (const rows of SIZES) {
    L.push(`## Streaming, plain page (hydratable bundles) — ${rows.toLocaleString('en-US')} rows`, '');
    L.push(...streamTable(summary, rows), '');
  }
  for (const rows of SIZES) {
    L.push(`## Streaming, table inside one async boundary (${DELAY_MS} ms) — ${rows.toLocaleString('en-US')} rows`, '');
    L.push(...asyncTable(summary, rows), '');
  }
  L.push('"shell end" is when the `<footer>` that follows the boundary was written: a',
    'shell-first streamer sends it (with the fallback) before the data exists; an in-order',
    'streamer cannot send it until the boundary has resolved and rendered.', '');

  L.push('## Hydration in Chromium', '');
  const hyd = meta.hydration;
  if (!hyd) {
    L.push('Not in this run: `node hydrate.mjs` writes `dist/hydrate/results.json` at the commit',
      `bench.mjs reports (${meta.git.commit}); run it before \`node bench.mjs\` to include it here.`, '');
  } else {
    L.push(`\`hydrate.mjs\`${hyd.quick ? ' --quick' : ''} at git ${hyd.git} on ${hyd.date}, Chromium ${hyd.chromium}, ${hyd.runs} runs per entry and page`,
      `(median), load average at its end ${hyd.loadavg.join(' / ')}. Each run is a fresh page: the first, cold call of a page`,
      'load. "client render" is the same bundle rendering the same page into an empty container;',
      '"nodes created" counts what the page holds after hydrating that it did not hold before (a text',
      'node split off the server\'s counts).', '');
    for (const [page, title] of Object.entries(hyd.pages)) {
      L.push(`### ${title}`, '',
        '| entry | hydrate ms | interactive ms | client render ms | hydrate / render | nodes created | client gzip B |',
        '|---|---:|---:|---:|---:|---:|---:|');
      for (const r of hyd.rows.filter((x) => x.page === page)) L.push(`| ${r.entry} | ${r.hydrateMs} | ${r.interactiveMs} | ${r.renderMs} | ${r.ratio} | ${r.created} | ${int(r.clientGzip)} |`);
      L.push('');
    }
  }

  const failures = Object.values(summary).filter((e) => e.errors.length);
  if (failures.length) {
    L.push('## Failed jobs', '');
    for (const e of failures) L.push(`- ${e.op} ${e.framework}.${e.mode} ${e.rows} rows: ${e.errors.length} failure(s); first: \`${e.errors[0].split('\n')[0]}\``);
    L.push('');
  }

  L.push('## Methodology', '',
    'See the header of `bench.mjs` and `worker.mjs`. Same page, same seeded data, every',
    'framework compiled by its own compiler in server mode; output is asserted (rows, cell',
    'text, selected row, structure after stripping hydration markers) before anything is',
    'timed, and the assertion code is self-tested against broken markup first.', '');
  L.push('## Caveats — read before quoting these numbers', '',
    '- What appears twice: "what h() vnodes" is the automatic-JSX-runtime page rendered by',
    '  the vnode renderer (a runtime tree walk); "what compiled" is the same page compiled by',
    '  what-compiler\'s server target into string templates, as Solid 1/2 compile theirs.',
    '  See README.md for the mechanical explanation.',
    '- Streaming numbers are in-process (no sockets, no HTTP chunked framing). A chunk is',
    '  one `write()` on a Node Writable; React\'s ~4 KB chunks would each become a chunked',
    '  frame on a real response, which this benchmark does not charge for.',
    '- Solid streams serialize the async data into the page for hydration; React and What do',
    '  not, so their async-page byte counts are not like for like.',
    '- Single machine, Node only, no CPU pinning. Differences under ~10% (or under the round',
    '  spread) are noise.', '');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
if (!existsSync(path.join(here, 'dist', 'manifest.json'))) {
  console.error('dist/ is missing: run `node build.mjs` first (or `npm run bench`).');
  process.exit(1);
}
selfTestVerifier();
const manifest = JSON.parse(await readFile(path.join(here, 'dist', 'manifest.json'), 'utf8'));
const jobs = planJobs();
const outputs = [];
const started = Date.now();
const loadavg = os.loadavg().map((v) => v.toFixed(2));
for (const [i, job] of jobs.entries()) {
  process.stdout.write(`[${i + 1}/${jobs.length}] round ${job.round + 1} ${job.op} ${job.bundle} ${job.rows} rows ... `);
  const out = runJob(job);
  outputs.push(out);
  console.log(out.ok ? 'ok' : `FAILED\n${out.error}`);
}

const summary = aggregate(jobs, outputs);

// hydrate.mjs's last results, when they were measured at this commit.
async function hydrationResults() {
  const file = path.join(here, 'dist', 'hydrate', 'results.json');
  if (!existsSync(file)) return null;
  const results = JSON.parse(await readFile(file, 'utf8'));
  return results.git === git('rev-parse --short HEAD') ? results : null;
}
const pkgVersions = new Map();
for (const b of Object.values(manifest.bundles)) for (const p of b.packages) pkgVersions.set(`${p.name}@${p.version}`, p.path);
const meta = {
  date: new Date().toISOString(),
  quick: QUICK,
  durationSec: Math.round((Date.now() - started) / 1000),
  node: process.versions.node,
  v8: process.versions.v8,
  git: { commit: git('rev-parse --short HEAD'), whatDirtyFiles: manifest.bundles['what.plain']?.git?.dirtyFiles ?? null },
  machine: {
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: os.cpus()[0]?.model || 'unknown',
    cores: os.cpus().length,
    memGB: Math.round(os.totalmem() / 1e9),
    loadavg,
  },
  versions: [...pkgVersions.keys()].filter((k) => /^(solid-js|@solidjs\/(web|signals)|react|react-dom)@/.test(k)).map((k) => `${k} (${pkgVersions.get(k)})`).join(', '),
  config: { rounds: ROUNDS, counts: COUNTS, delayMs: DELAY_MS, sizes: SIZES, semiSpaceMB: SEMI_SPACE_MB },
  manifest,
  hydration: await hydrationResults(),
};

await writeFile(path.join(here, 'results.json'), JSON.stringify({ meta, summary, jobs: jobs.map((job, i) => ({ ...job, result: outputs[i] })) }, null, 1) + '\n');
await writeFile(path.join(here, 'RESULTS.md'), renderMarkdown(meta, summary));
const failures = outputs.filter((o) => !o.ok).length;
console.log(`\nwrote RESULTS.md and results.json in ${meta.durationSec}s${failures ? ` (${failures} job(s) FAILED)` : ''}`);
if (failures) process.exitCode = 1;
