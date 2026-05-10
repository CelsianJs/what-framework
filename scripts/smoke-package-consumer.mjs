#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PACKAGE_DIRS = [
  'packages/core',
  'packages/router',
  'packages/server',
  'packages/compiler',
  'packages/devtools',
  'packages/mcp-server',
  'packages/devtools-mcp',
  'packages/eslint-plugin',
  'packages/react-compat',
  'packages/what',
  'packages/cli',
  'packages/create-what',
];

const workspace = mkdtempSync(join(tmpdir(), 'what-fw-pack-smoke-'));
const tarballDir = join(workspace, 'tarballs');
const consumerDir = join(workspace, 'consumer');

try {
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const tarballs = [];
  for (const relDir of PACKAGE_DIRS) {
    const pkgDir = join(repoRoot, relDir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    if (pkg.private) continue;

    console.log(`[pack-smoke] Packing ${pkg.name}@${pkg.version}`);
    const result = run('npm', ['pack', '--json', '--pack-destination', tarballDir], { cwd: pkgDir, capture: true });
    const packed = JSON.parse(result.stdout);
    const filename = packed[0]?.filename;
    if (!filename) throw new Error(`npm pack did not report a tarball for ${pkg.name}`);
    tarballs.push(join(tarballDir, filename));
  }

  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'what-fw-package-consumer-smoke',
    private: true,
    type: 'module',
  }, null, 2));

  console.log('[pack-smoke] Installing packed packages into a clean consumer project');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], { cwd: consumerDir });

  writeFileSync(join(consumerDir, 'smoke.mjs'), `
import { signal, computed } from 'what-core';
import { signal as frameworkSignal } from 'what-framework';
import { isSafeUrl } from 'what-router';
import { renderToString } from 'what-server';
import * as ReactCompat from 'what-react';

const count = signal(2);
const doubled = computed(() => count() * 2);
if (doubled() !== 4) throw new Error('what-core signal/computed import failed');

const fwCount = frameworkSignal(1);
if (fwCount() !== 1) throw new Error('what-framework umbrella import failed');

if (isSafeUrl('javascript:alert(1)')) throw new Error('what-router import failed');
if (typeof renderToString !== 'function') throw new Error('what-server import failed');
if (!ReactCompat || typeof ReactCompat !== 'object') throw new Error('what-react import failed');
`);


  writeFileSync(join(consumerDir, 'production-smoke.mjs'), `
import { signal, computed } from 'what-core';
import { template } from 'what-core/render';
import { signal as frameworkSignal } from 'what-framework';
import { isSafeUrl } from 'what-router';
import { renderToString } from 'what-server';

const count = signal(3);
const doubled = computed(() => count() * 2);
if (doubled() !== 6) throw new Error('what-core production condition import failed');

const fwCount = frameworkSignal(2);
if (fwCount() !== 2) throw new Error('what-framework production condition import failed');

if (isSafeUrl('javascript:alert(1)')) throw new Error('what-router production condition import failed');
if (typeof renderToString !== 'function') throw new Error('what-server production condition import failed');
if (typeof template !== 'function') throw new Error('what-core/render production condition import failed');
`);

  run('node', ['smoke.mjs'], { cwd: consumerDir });
  run('node', ['--conditions=production', 'production-smoke.mjs'], { cwd: consumerDir });
  run('npx', ['--no-install', 'what'], { cwd: consumerDir });
  run('node', [join(repoRoot, 'scripts/smoke-cli-flows.mjs')], {
    cwd: consumerDir,
    env: { ...process.env, WHAT_CLI_BIN: join(consumerDir, 'node_modules/.bin/what') },
  });
  run('npx', ['--no-install', 'create-what', '--help'], { cwd: consumerDir });
  console.log('[pack-smoke] Package consumer smoke passed');
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE_TMP) {
    console.log(`[pack-smoke] Kept temp directory: ${workspace}`);
  } else {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${cmd} ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result;
}
