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
import { dirname, join, relative, resolve } from 'node:path';
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

// The root manifest is private and unpublished, so nothing forced it to move and
// it silently stopped: the group shipped 0.11.1 through 0.11.7 while the root
// still read 0.11.0. That is the first version number anyone reads when they
// clone the repo or look at the GitHub landing page, and it disagreed with every
// published package for six releases. It tracks the group now.
const rootManifest = join(repoRoot, 'package.json');
if (existsSync(rootManifest)) {
  const json = JSON.parse(readFileSync(rootManifest, 'utf8'));
  if (json.version !== next) {
    json.version = next;
    if (!dry) writeFileSync(rootManifest, JSON.stringify(json, null, 2) + '\n');
    console.log(`  ${'(root package.json)'.padEnd(24)} -> ${next}`);
  }
}

// The smoke apps pin what-* at an EXACT version so `cd smoke/apps/<name> &&
// npm install` installs the release those apps were written against. They are
// private and not workspace members, so nothing else moves them, and a stale pin
// means the checked-in demos quietly install an old framework. (The smoke RUNNER
// rewrites these to tarballs or a chosen registry version, so a stale pin never
// affects a smoke run: it only affects a human opening the demo.)
const smokeAppsDir = join(repoRoot, 'smoke', 'apps');
if (existsSync(smokeAppsDir)) {
  let smokePins = 0;
  for (const entry of readdirSync(smokeAppsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(smokeAppsDir, entry.name, 'package.json');
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, 'utf8'));
    let changed = false;
    for (const field of DEP_FIELDS) {
      if (!json[field]) continue;
      for (const [name, range] of Object.entries(json[field])) {
        if (internalNames.has(name) && range !== next) {
          json[field][name] = next;
          changed = true;
          smokePins++;
        }
      }
    }
    if (changed) {
      if (!dry) writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      console.log(`  ${`smoke/apps/${entry.name}`.padEnd(24)} -> ${next}`);
    }
  }
  if (smokePins) console.log(`  ${'(smoke app pins)'.padEnd(24)} ${smokePins} updated`);
}

// whatfw.com is the flagship "built with What" claim, so the version it RENDERS
// with has to be the version it advertises.
//
// It was pinned at `^0.10.0`, and a caret on a 0.x version pins the MINOR, so it
// resolved to 0.10.0 and nothing ever moved it. The site rendered through What
// 0.10.0 for two minor releases while displaying a badge read from the monorepo
// at build time, so it truthfully showed v0.12.3 above markup that 0.10.0 had
// produced. Nobody noticed because the badge was right.
//
// An exact pin moved by this script is the only arrangement where that cannot
// drift again. docs-site is private and not a workspace member, so nothing else
// would move it.
// The same trap caught every other non-workspace manifest in the repo, and worse.
// A caret range on a 0.x version pins the MINOR: `^0.6.0` resolves >=0.6.0 <0.7.0.
// So the twenty-odd apps under examples/ that read `"what-framework": "^0.6.0"`
// installed a framework six minor releases old, and sites/react-compat (^0.10.0)
// and sites/playground (^0.11.1) each froze at whatever was current the day they
// were written. Every one of them is code a reader is invited to clone and run.
//
// Left alone deliberately: `file:` links (a workspace link is the correct answer,
// not a version) and `*` (already floats to latest).
const EXTERNAL_MANIFESTS = [
  join(repoRoot, 'docs-site', 'package.json'),
  ...findManifests(join(repoRoot, 'sites')),
  ...findManifests(join(repoRoot, 'examples')),
];

function findManifests(dir, depth = 3) {
  if (depth < 0 || !existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const child = join(dir, entry.name);
    const manifest = join(child, 'package.json');
    if (existsSync(manifest)) out.push(manifest);
    out.push(...findManifests(child, depth - 1));
  }
  return out;
}

// A range this script owns: a plain version, optionally with ^ or ~.
const MOVABLE_RANGE = /^[\^~]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

for (const manifest of EXTERNAL_MANIFESTS) {
  if (!existsSync(manifest)) continue;
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  let changed = false;
  if (json.version && MOVABLE_RANGE.test(json.version) && json.version !== next) {
    json.version = next;
    changed = true;
  }
  for (const field of DEP_FIELDS) {
    if (!json[field]) continue;
    for (const [name, range] of Object.entries(json[field])) {
      if (!internalNames.has(name)) continue;
      if (!MOVABLE_RANGE.test(range)) continue; // file:, *, workspace: are intentional
      if (range === next) continue;
      json[field][name] = next;
      changed = true;
    }
  }
  if (changed) {
    if (!dry) writeFileSync(manifest, JSON.stringify(json, null, 2) + '\n');
    console.log(`  ${relative(repoRoot, manifest).padEnd(24)} -> ${next}`);
  }
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
