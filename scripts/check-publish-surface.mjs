#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { packages as buildPackages } from './build.js';

const repoRoot = resolve(import.meta.dirname, '..');

const allowedPublicPackageJson = new Set([
  'packages/cache/package.json',
  'packages/cli/package.json',
  'packages/compiler/package.json',
  'packages/core/package.json',
  'packages/create-what/package.json',
  'packages/devtools-mcp/package.json',
  'packages/devtools/package.json',
  'packages/eslint-plugin/package.json',
  'packages/mcp-server/package.json',
  'packages/react-compat/package.json',
  'packages/router/package.json',
  'packages/server/package.json',
  'packages/what-text/package.json',
  'packages/what/package.json',
]);

const trackedPackageJson = execFileSync('git', ['ls-files', '*package.json'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((path) => !path.includes('/node_modules/'));

const unexpectedPublic = [];
const missingAllowed = [];

for (const path of trackedPackageJson) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
  if (allowedPublicPackageJson.has(path)) {
    if (pkg.private === true) {
      missingAllowed.push(`${path} is listed as public but has private=true`);
    }
    continue;
  }
  if (pkg.private !== true) {
    unexpectedPublic.push(`${path} (${pkg.name || '<unnamed>'})`);
  }
}

for (const path of allowedPublicPackageJson) {
  if (!trackedPackageJson.includes(path)) {
    missingAllowed.push(`${path} is listed as public but is not tracked`);
  }
}

if (unexpectedPublic.length || missingAllowed.length) {
  console.error('[publish-surface] Invalid package publish surface.');
  if (unexpectedPublic.length) {
    console.error('\nUnexpected non-private package manifests:');
    for (const item of unexpectedPublic) console.error(`  - ${item}`);
  }
  if (missingAllowed.length) {
    console.error('\nInvalid intended public package manifests:');
    for (const item of missingAllowed) console.error(`  - ${item}`);
  }
  console.error(
    `\nOnly ${relative(repoRoot, repoRoot) || '.'}/packages/* release packages in the allowlist may be non-private.`,
  );
  process.exit(1);
}

console.log(
  `[publish-surface] OK: ${allowedPublicPackageJson.size} intended public packages; all other tracked package manifests are private.`,
);

// ---------------------------------------------------------------------------
// Dist-content allowlist
//
// scripts/build.js cleans dist/ on every run, so after a build the ONLY files
// allowed in packages/<name>/dist are:
//   - <entry>.js / <entry>.min.js (+ .map) for each build entry
//   - chunk-<hash>(.min).js (+ .map) actually referenced by THIS build's
//     entry files (followed transitively)
//   - *.d.ts type declarations
// Anything else is a stale artifact from a previous build (an "orphan") and
// would ship to npm via the `files: ["dist…"]` globs — fail loudly.
// ---------------------------------------------------------------------------

const CHUNK_REF_RE = /chunk-[A-Za-z0-9]+(?:\.min)?\.js/g;

const distOrphans = [];
const distMissing = [];
let distCheckedPackages = 0;

for (const pkg of buildPackages) {
  const pkgDir = resolve(repoRoot, 'packages', pkg.name);
  const distDir = join(pkgDir, 'dist');
  if (!existsSync(distDir)) {
    // Not built yet (fresh clone) — nothing stale can ship. The release path
    // re-runs this script after `npm run build`, which validates for real.
    console.log(`[publish-surface] note: packages/${pkg.name}/dist not built; skipping dist check.`);
    continue;
  }
  distCheckedPackages += 1;

  const allowed = new Set();
  const entryFiles = [];
  for (const entry of pkg.entries) {
    if (!existsSync(join(pkgDir, entry.input))) continue;
    for (const name of [`${entry.outputBase}.js`, `${entry.outputBase}.min.js`]) {
      allowed.add(name);
      allowed.add(`${name}.map`);
      if (existsSync(join(distDir, name))) {
        entryFiles.push(name);
      } else {
        distMissing.push(`packages/${pkg.name}/dist/${name} (expected build output is missing)`);
      }
    }
  }

  // Follow chunk references transitively from this build's entry files so the
  // allowlist only contains chunks that belong to the CURRENT build.
  const queue = [...entryFiles];
  const scanned = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (scanned.has(file)) continue;
    scanned.add(file);
    const content = readFileSync(join(distDir, file), 'utf8');
    for (const chunk of content.match(CHUNK_REF_RE) ?? []) {
      if (!allowed.has(chunk)) {
        allowed.add(chunk);
        allowed.add(`${chunk}.map`);
        if (existsSync(join(distDir, chunk))) queue.push(chunk);
      }
    }
  }

  for (const file of readdirSync(distDir).sort()) {
    if (file.endsWith('.d.ts')) continue;
    if (!allowed.has(file)) {
      distOrphans.push(`packages/${pkg.name}/dist/${file}`);
    }
  }
}

if (distOrphans.length || distMissing.length) {
  console.error('\n[publish-surface] Invalid dist contents.');
  if (distOrphans.length) {
    console.error('\nOrphan dist files (not produced by the current build config — stale artifacts would ship to npm):');
    for (const item of distOrphans) console.error(`  - ${item}`);
  }
  if (distMissing.length) {
    console.error('\nMissing expected build outputs (dist exists but is incomplete):');
    for (const item of distMissing) console.error(`  - ${item}`);
  }
  console.error('\nRun `node scripts/build.js` to regenerate dist/ from scratch.');
  process.exit(1);
}

console.log(
  `[publish-surface] OK: dist contents match the build config for ${distCheckedPackages}/${buildPackages.length} built packages (no orphans).`,
);
