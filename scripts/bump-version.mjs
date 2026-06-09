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

console.log(`\n[bump] ${manifests.length} packages set to ${next}; ${changedRanges} internal ^ranges retargeted to ${newRange}.`);
if (dry) console.log('[bump] dry run — no files written.');
