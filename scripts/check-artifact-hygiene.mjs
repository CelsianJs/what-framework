#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const forbidden = [
  /^test-results\//,
  /^examples\/[^/]+\/test-results\//,
];

const res = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
if (res.status !== 0) {
  process.stderr.write(res.stderr || 'git ls-files failed\n');
  process.exit(res.status || 1);
}

const trackedFiles = res.stdout.split(/\r?\n/).filter(Boolean);

const offenders = trackedFiles.filter((file) => forbidden.some((pattern) => pattern.test(file)));
if (offenders.length > 0) {
  console.error('Playwright/test artifacts are tracked:');
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}


const trackedDistFiles = trackedFiles.filter((file) => file.includes('/dist/'));
const allowedDistPatterns = [
  /^packages\/[^/]+\/dist\//,
  /^sites\/react-compat\/dist\//,
];
const unexpectedDistFiles = trackedDistFiles.filter((file) => !allowedDistPatterns.some((pattern) => pattern.test(file)));
if (unexpectedDistFiles.length > 0) {
  console.error('Unexpected generated dist files are tracked:');
  for (const file of unexpectedDistFiles) console.error(`  - ${file}`);
  console.error('Only package publish artifacts and the checked-in react-compat static site dist are allowed.');
  process.exit(1);
}


const manifestRoots = ['benchmark', 'comparison-test/benchmark'];
const benchmarkManifests = [];

function collectPackageManifests(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPackageManifests(path);
    } else if (entry.isFile() && entry.name === 'package.json') {
      benchmarkManifests.push(path);
    }
  }
}

for (const root of manifestRoots) collectPackageManifests(root);

const publicBenchmarkManifests = benchmarkManifests.filter((file) => {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  return pkg.private !== true;
});
if (publicBenchmarkManifests.length > 0) {
  console.error('Benchmark/comparison package manifests must be private:');
  for (const file of publicBenchmarkManifests) console.error(`  - ${file}`);
  process.exit(1);
}

console.log('OK: no tracked Playwright/test-result artifacts.');
console.log('OK: tracked dist artifacts are limited to intentional publish/static-site outputs.');
console.log('OK: benchmark/comparison package manifests are private.');
