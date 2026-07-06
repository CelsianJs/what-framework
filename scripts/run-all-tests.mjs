#!/usr/bin/env node
// Run every package's node:test suite (D3, sprint/v0.11-quality).
//
// The old root "test" script enumerated package test dirs by hand and silently
// omitted packages (devtools, eslint-plugin, react-compat, what). This runner
// DISCOVERS packages/*/test/*.test.js and examples/*/test/*.test.js so a new
// package's tests can never be forgotten again.
//
// Why a script instead of `node --test <glob>`: the repo supports Node >= 20
// (package.json engines), and the test runner's own glob expansion is only
// reliable on Node >= 21 — shell globbing differs across sh/zsh/Windows.
//
// Usage:
//   node scripts/run-all-tests.mjs              # run everything
//   node scripts/run-all-tests.mjs server core  # only matching package names

import { readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filters = process.argv.slice(2);

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function testFilesIn(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mjs'))
    .map((f) => join(dir, f))
    .sort();
}

const files = [];
for (const groupDir of ['packages', 'examples', 'scripts']) {
  const base = join(root, groupDir);
  if (!isDir(base)) continue;
  for (const name of readdirSync(base).sort()) {
    if (filters.length && !filters.some((f) => name.includes(f))) continue;
    files.push(...testFilesIn(join(base, name, 'test')));
  }
}

if (files.length === 0) {
  console.error('[run-all-tests] No test files found' + (filters.length ? ` for filters: ${filters.join(', ')}` : ''));
  process.exit(1);
}

const suites = new Set(files.map((f) => relative(root, dirname(f))));
console.log(`[run-all-tests] ${files.length} test files across ${suites.size} suites:`);
for (const s of [...suites].sort()) console.log(`  - ${s}`);

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
