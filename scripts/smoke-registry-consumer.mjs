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

const workspace = mkdtempSync(join(tmpdir(), 'what-fw-registry-smoke-'));
const consumerDir = join(workspace, 'consumer');
const artifactPath = process.env.WHAT_REGISTRY_SMOKE_ARTIFACT || join(repoRoot, 'artifacts/registry-smoke.json');

try {
  mkdirSync(consumerDir, { recursive: true });

  const specs = [];
  for (const relDir of PACKAGE_DIRS) {
    const pkgDir = join(repoRoot, relDir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    const selector = process.env.WHAT_REGISTRY_VERSION || pkg.version;
    specs.push(`${pkg.name}@${selector}`);
  }
  if (specs.length === 0) throw new Error('No public What packages found for registry smoke');

  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'what-fw-registry-consumer-smoke',
    private: true,
    type: 'module',
  }, null, 2));

  console.log('[registry-smoke] Installing published packages into a clean consumer project');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...specs], { cwd: consumerDir });

} finally {
  if (process.env.KEEP_PACKAGE_SMOKE_TMP) {
    console.log(`[registry-smoke] Kept temp directory: ${workspace}`);
  } else {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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
