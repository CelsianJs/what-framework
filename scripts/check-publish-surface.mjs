#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const allowedPublicPackageJson = new Set([
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
