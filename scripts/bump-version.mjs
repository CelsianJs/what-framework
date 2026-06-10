#!/usr/bin/env node
// Unified version bump for the What Framework monorepo (fixed-group release).
// Bumps EVERY packages/* package.json to one new version and rewrites internal
// `^` dependency ranges (what-* / create-what) to match — so a release never
// ships with a stale internal range (the bug that made install break at 0.8.4).
//
// Usage:
//   node scripts/bump-version.mjs patch        # 0.10.0 -> 0.10.1
//   node scripts/bump-version.mjs minor        # 0.10.0 -> 0.11.0
//   node scripts/bump-version.mjs major        # 0.10.0 -> 1.0.0
//   node scripts/bump-version.mjs 0.12.3       # explicit version
//   node scripts/bump-version.mjs minor --dry  # print plan, write nothing
//
// Loose ranges (`>=x`, `*`, `workspace:*`) are left untouched on purpose.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = join(repoRoot, 'packages');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bumpArg = args.find((a) => !a.startsWith('--')) || 'patch';

const pkgDirs = readdirSync(pkgsDir)
  .map((d) => join(pkgsDir, d))
  .filter((d) => existsSync(join(d, 'package.json')));

const manifests = pkgDirs.map((d) => {
  const file = join(d, 'package.json');
  return { file, json: JSON.parse(readFileSync(file, 'utf8')) };
});

// Current baseline = highest version across the group (guards against drift).
function parse(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function cmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

const current = manifests
  .map((m) => parse(m.json.version))
  .reduce((max, v) => (cmp(v, max) > 0 ? v : max), [0, 0, 0]);

let next;
if (/^\d+\.\d+\.\d+/.test(bumpArg)) {
  next = bumpArg.match(/^\d+\.\d+\.\d+/)[0];
} else if (bumpArg === 'major') {
  next = `${current[0] + 1}.0.0`;
} else if (bumpArg === 'minor') {
  next = `${current[0]}.${current[1] + 1}.0`;
} else if (bumpArg === 'patch') {
  next = `${current[0]}.${current[1]}.${current[2] + 1}`;
} else {
  console.error(`[bump] Unknown bump arg "${bumpArg}". Use patch|minor|major|x.y.z.`);
  process.exit(1);
}

// Names defined within this monorepo — their `^` ranges move with the group.
const internalNames = new Set(manifests.map((m) => m.json.name));

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];
const newRange = `^${next}`;
let changedRanges = 0;

console.log(`[bump] ${current.join('.')} -> ${next}${dry ? '  (dry run)' : ''}\n`);

for (const { file, json } of manifests) {
  json.version = next;
  for (const field of DEP_FIELDS) {
    if (!json[field]) continue;
    for (const [name, range] of Object.entries(json[field])) {
      // Only retarget internal packages pinned with a caret range.
      if (internalNames.has(name) && typeof range === 'string' && range.startsWith('^') && range !== newRange) {
        json[field][name] = newRange;
        changedRanges++;
      }
    }
  }
  if (!dry) writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`  ${json.name.padEnd(24)} -> ${next}`);
}

// Keep the hardcoded VERSION constant in agent-context.js in sync (guarded by a
// version-match test in packages/core/test/guardrails.test.js — would fail CI otherwise).
const agentCtx = join(pkgsDir, 'core', 'src', 'agent-context.js');
if (existsSync(agentCtx)) {
  const src = readFileSync(agentCtx, 'utf8');
  const updated = src.replace(/const VERSION = '[^']*';/, `const VERSION = '${next}';`);
  if (updated !== src) {
    if (!dry) writeFileSync(agentCtx, updated);
    console.log(`  ${'agent-context.js VERSION'.padEnd(24)} -> ${next}`);
  }
}

// --- Docs/version-surface sync ---------------------------------------------
// Version staleness in docs has regressed repeatedly (0.8.4, 0.10.0, 0.11.0
// audits all flagged it). Make it mechanical: every bump also stubs the
// CHANGELOG, moves the SECURITY supported-versions row, and sweeps known
// hardcoded-version spots. All simple regex/string work, all honoring --dry.

const currentStr = current.join('.');

// 1) CHANGELOG.md: insert a stub section for the new version (idempotent).
const changelogPath = join(repoRoot, 'CHANGELOG.md');
if (existsSync(changelogPath)) {
  const src = readFileSync(changelogPath, 'utf8');
  if (!src.includes(`## [${next}]`)) {
    const today = new Date().toISOString().slice(0, 10);
    const stub = `## [${next}] - ${today}\n\n_Release notes pending — summarize the changes here (and in docs/releases/v${next}.md) before publishing._\n\n`;
    const firstHeading = src.search(/^## \[/m);
    const updated = firstHeading === -1
      ? src.trimEnd() + '\n\n' + stub
      : src.slice(0, firstHeading) + stub + src.slice(firstHeading);
    if (!dry) writeFileSync(changelogPath, updated);
    console.log(`  ${'CHANGELOG.md'.padEnd(24)} -> stub section [${next}] inserted`);
  } else {
    console.log(`  ${'CHANGELOG.md'.padEnd(24)} -> [${next}] section already present`);
  }
}

// 2) SECURITY.md: move the supported-versions window to the new minor.
//    Reads the minor currently in the file (drift-proof) rather than assuming
//    it matches the package versions.
const securityPath = join(repoRoot, 'SECURITY.md');
if (existsSync(securityPath)) {
  const src = readFileSync(securityPath, 'utf8');
  const row = src.match(/\|\s*(\d+\.\d+)\.x\s*\|\s*Yes/);
  const nextMM = next.split('.').slice(0, 2).join('.');
  if (row && row[1] !== nextMM) {
    const oldMM = row[1];
    const updated = src
      .replaceAll(`${oldMM}.x`, `${nextMM}.x`)
      .replaceAll(`< ${oldMM}`, `< ${nextMM}`);
    if (!dry) writeFileSync(securityPath, updated);
    console.log(`  ${'SECURITY.md'.padEnd(24)} -> supported versions ${oldMM}.x => ${nextMM}.x`);
  }
}

// 3) Sweep known hardcoded-version spots: replace the current group version
//    (with or without a leading "v") with the new one. CHANGELOG and
//    docs/releases are intentionally NOT swept (historical records).
const SWEEP_FILES = [
  'README.md',
  'GETTING-STARTED.md',
  'docs/QUICKSTART.md',
  'docs/API.md',
  'docs-site/index.html',
  'sites/benchmarks/index.html',
  'sites/react-compat/index.html',
  'sites/playground/index.html',
];
// Version badges repeat across every generated docs page.
const SWEEP_DIRS = ['docs-site/docs'];

function* walkHtml(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(p);
    else if (entry.name.endsWith('.html')) yield p;
  }
}

const sweepTargets = SWEEP_FILES.map((f) => join(repoRoot, f)).filter(existsSync);
for (const dir of SWEEP_DIRS) {
  const abs = join(repoRoot, dir);
  if (existsSync(abs)) sweepTargets.push(...walkHtml(abs));
}

let sweptFiles = 0;
let sweptHits = 0;
const staleAfterSweep = [];
for (const file of sweepTargets) {
  const src = readFileSync(file, 'utf8');
  const hits = src.split(currentStr).length - 1;
  let updated = src;
  if (hits > 0 && currentStr !== next) {
    updated = src.replaceAll(currentStr, next);
    if (!dry) writeFileSync(file, updated);
    sweptFiles++;
    sweptHits += hits;
  }
  // Drift warning: a "vX.Y.Z" left behind that is neither the new version nor
  // the one we just replaced means the file was already stale before this bump.
  // Majors far above ours are other tools' versions (e.g. Node "v22.x" on the
  // benchmarks page), not framework drift — skip those.
  const nextMajor = Number(next.split('.')[0]);
  const leftover = [...updated.matchAll(/v(\d+\.\d+\.\d+)/g)]
    .map((m) => m[1])
    .filter((v) => v !== next && v !== currentStr && Number(v.split('.')[0]) <= nextMajor + 1);
  if (leftover.length > 0) {
    staleAfterSweep.push(`${file.slice(repoRoot.length + 1)} (${[...new Set(leftover)].join(', ')})`);
  }
}
console.log(`  ${'version sweep'.padEnd(24)} -> ${sweptHits} occurrence(s) of ${currentStr} across ${sweptFiles} file(s) -> ${next}`);
if (staleAfterSweep.length > 0) {
  console.warn(`\n[bump] WARNING: stale-looking versions remain after sweep (fix by hand):`);
  for (const s of staleAfterSweep) console.warn(`  - ${s}`);
}

console.log(`\n[bump] ${manifests.length} packages set to ${next}; ${changedRanges} internal ^ranges retargeted to ${newRange}.`);
if (dry) console.log('[bump] dry run — no files written.');
