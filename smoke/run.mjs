#!/usr/bin/env node
// App smoke suite: builds and drives real applications against a chosen build
// of the framework, then asserts a declared capability matrix actually held.
//
// Why this exists, precisely: 0.12.0 and 0.12.1 shipped a what-server packaging
// defect that every unit test, the type gates and the scaffold smoke all passed.
// It was only observable to something that INSTALLED the published artifact and
// used it. `--source=npm` is that something.
//
// Usage:
//   node smoke/run.mjs                          # workspace code (pre-release)
//   node smoke/run.mjs --source=npm             # published `latest`
//   node smoke/run.mjs --source=npm --version=0.12.2
//   node smoke/run.mjs --apps=storefront        # one app, while iterating
//   node smoke/run.mjs --keep                   # keep the workdir to inspect
//
// Exits non-zero if any check fails, any capability is uncovered, or any
// declared capability never reported a passing check.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPackageSource,
  assertPortFree,
  createReporter,
  killAllChildren,
  launchBrowser,
  resolvePackageSource,
  run,
  verifyInstalledSource,
} from './harness/index.mjs';
import { CAPABILITIES, auditResults, coverageReport, validateCoverage } from './harness/capabilities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const APPS_DIR = join(HERE, 'apps');
const PORT_BASE = Number(process.env.WHAT_SMOKE_APP_PORT_BASE) || 4700;

function flag(name, fallback = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

const SOURCE = flag('source', 'workspace');
const KEEP = !!flag('keep', false);
const ONLY = flag('apps', null);

if (!['workspace', 'npm'].includes(SOURCE)) {
  console.error(`--source must be "workspace" or "npm" (got "${SOURCE}")`);
  process.exit(2);
}

const VERSION = flag('version', null)
  || JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;

function log(msg) { console.log(`[smoke-apps] ${msg}`); }

// --- Load app definitions --------------------------------------------------

const appNames = readdirSync(APPS_DIR).filter((d) => existsSync(join(APPS_DIR, d, 'smoke.config.mjs')));
const wanted = ONLY ? String(ONLY).split(',').map((s) => s.trim()) : appNames;

const apps = [];
for (const name of wanted) {
  if (!appNames.includes(name)) {
    console.error(`unknown app "${name}"; available: ${appNames.join(', ')}`);
    process.exit(2);
  }
  const mod = await import(join(APPS_DIR, name, 'smoke.config.mjs'));
  apps.push({ name, dir: join(APPS_DIR, name), ...mod.default });
}

// --- Coverage contract (before doing any expensive work) -------------------
// Only enforced on a full run: a filtered run legitimately covers a subset.

const isFullRun = !ONLY;
const { problems: coverageProblems, covered } = validateCoverage(apps);
if (isFullRun && coverageProblems.length) {
  console.error('\nCapability coverage contract violated:');
  for (const p of coverageProblems) console.error(`  - ${p}`);
  console.error('\nEither cover the capability in an app or remove it from smoke/harness/capabilities.mjs.');
  process.exit(1);
}

log(`source=${SOURCE}${SOURCE === 'npm' ? ` version=${VERSION}` : ''} apps=${apps.map((a) => a.name).join(',')}`);

// --- Run -------------------------------------------------------------------

const workRoot = mkdtempSync(join(tmpdir(), 'what-smoke-apps-'));
const allResults = [];
let browser = null;

try {
  const pkgSource = resolvePackageSource({
    source: SOURCE,
    version: VERSION,
    repoRoot: REPO,
    tarballDir: join(workRoot, 'tarballs'),
    log,
  });

  browser = await launchBrowser({ required: true });

  let port = PORT_BASE;
  for (const app of apps) {
    console.log(`\n── ${app.name} ──────────────────────────────────────────`);
    const appPort = port++;
    await assertPortFree(appPort);

    // Copy to a workdir so the checked-in app stays pristine and demoable:
    // `cd smoke/apps/<name> && npm i && npm run dev` must keep working.
    const workDir = join(workRoot, app.name);
    cpSync(app.dir, workDir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes(`${app.name}/dist`),
    });

    applyPackageSource(workDir, pkgSource.specs);
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: workDir });
    verifyInstalledSource(workDir, { kind: pkgSource.kind, version: VERSION });
    log(`installed ${app.name} (${pkgSource.kind})`);

    const reporter = createReporter(app.name);
    const capabilityOf = new Map();
    const check = (capability, cond, name, detail) => {
      const passed = reporter.assert(cond, `[${capability}] ${name}`, detail);
      capabilityOf.set(capability, (capabilityOf.get(capability) ?? true) && passed);
      return passed;
    };

    try {
      await app.check({
        workDir,
        port,
        appPort,
        browser,
        check,
        reporter,
        log: (m) => console.log(`    .. ${m}`),
        run,
      });
    } catch (err) {
      reporter.fail('app harness', err.message.split('\n').slice(0, 4).join(' | '));
    }

    for (const r of reporter.results) {
      const m = /^\[([^\]]+)\]/.exec(r.name);
      allResults.push({ ...r, capability: m ? m[1] : null });
    }
    killAllChildren();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  killAllChildren();
  if (!KEEP) rmSync(workRoot, { recursive: true, force: true });
  else log(`workdir kept at ${workRoot}`);
}

// --- Report ----------------------------------------------------------------

const failures = allResults.filter((r) => !r.passed);
const unproven = isFullRun ? auditResults(apps, allResults) : [];

console.log('\n──────────── coverage ────────────');
const report = coverageReport(covered);
for (const [area, { total, covered: c }] of Object.entries(report)) {
  const mark = c === total ? 'ok  ' : 'GAP ';
  console.log(`  ${mark} ${area.padEnd(12)} ${c}/${total}`);
}
console.log(`\nchecks: ${allResults.length - failures.length}/${allResults.length} passed across ${apps.length} app(s)`);

const artifact = {
  source: SOURCE,
  version: VERSION,
  apps: apps.map((a) => a.name),
  capabilities: Object.keys(CAPABILITIES).length,
  results: allResults,
  failures: failures.length,
  unproven,
};
mkdirSync(join(REPO, 'artifacts'), { recursive: true });
writeFileSync(join(REPO, 'artifacts', 'smoke-apps.json'), `${JSON.stringify(artifact, null, 2)}\n`);

if (failures.length) {
  console.error('\nFailed checks:');
  for (const f of failures) console.error(`  - ${f.app}: ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
if (unproven.length) {
  console.error('\nDeclared capabilities with no passing check (the suite would be overstating coverage):');
  for (const u of unproven) console.error(`  - ${u}`);
}

if (failures.length || unproven.length) process.exit(1);
console.log('\nAll app smoke checks passed.');
