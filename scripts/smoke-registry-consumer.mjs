#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const CHECKED_BACKPORT_DIST_TAG_ALLOWLIST = new Set([
  // Deprecated 0.6.0 packages retained for compatibility; release docs pin them explicitly.
  'what-mcp',
  'eslint-plugin-what',
]);

try {
  mkdirSync(consumerDir, { recursive: true });

  const specs = [];
  const packageSpecs = [];
  const bins = [];
  for (const relDir of PACKAGE_DIRS) {
    const pkgDir = join(repoRoot, relDir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    const selector = process.env.WHAT_REGISTRY_VERSION || pkg.version;
    const spec = `${pkg.name}@${selector}`;
    specs.push(spec);
    packageSpecs.push({ name: pkg.name, version: pkg.version, selector, spec });
    if (typeof pkg.bin === 'string') bins.push((pkg.name || '').split('/').pop());
    if (pkg.bin && typeof pkg.bin === 'object') bins.push(...Object.keys(pkg.bin));
  }
  if (specs.length === 0) throw new Error('No public What packages found for registry smoke');

  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'what-fw-registry-consumer-smoke',
    private: true,
    type: 'module',
  }, null, 2));

  const expectedDistTag = process.env.WHAT_REGISTRY_DIST_TAG || inferExpectedDistTag(packageSpecs);
  const distTagChecks = expectedDistTag ? verifyDistTag(packageSpecs, expectedDistTag) : [];

  console.log('[registry-smoke] Installing published packages into a clean consumer project');
  retry('npm install from registry', () => run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...specs], { cwd: consumerDir }));

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

  for (const bin of bins) {
    if (!existsSync(join(consumerDir, 'node_modules/.bin', bin))) {
      throw new Error(`Expected installed binary ${bin} in registry smoke consumer`);
    }
  }

  run('npx', ['--no-install', 'what'], { cwd: consumerDir });
  run('node', [join(repoRoot, 'scripts/smoke-cli-flows.mjs')], {
    cwd: consumerDir,
    env: { ...process.env, WHAT_CLI_BIN: join(consumerDir, 'node_modules/.bin/what') },
  });
  run('npx', ['--no-install', 'create-what', '--help'], { cwd: consumerDir });

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    status: 'passed',
    generatedAt: new Date().toISOString(),
    packageCount: specs.length,
    packages: specs,
    binaries: bins,
    distTag: expectedDistTag || null,
    distTagChecks,
    distTagAllowlist: Array.from(getDistTagAllowlist()),
    checks: ['dist-tag verification/reporting when applicable', 'npm install --ignore-scripts with propagation retry', 'esm imports', 'production-condition imports', 'binary presence', 'what cli', 'real what CLI build/generate/dev/preview asset smoke', 'create-what --help'],
  }, null, 2) + '\n');

  console.log(`[registry-smoke] Registry consumer smoke passed for ${specs.length} package(s)`);
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE_TMP) {
    console.log(`[registry-smoke] Kept temp directory: ${workspace}`);
  } else {
    rmSync(workspace, { recursive: true, force: true });
  }
}


function inferExpectedDistTag(packageSpecs) {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  if (/^0\.6\./.test(rootPkg.version) && packageSpecs.some(pkg => /^0\.6\./.test(pkg.version))) {
    return 'backport';
  }
  return '';
}

function getDistTagAllowlist() {
  const allowed = new Set(CHECKED_BACKPORT_DIST_TAG_ALLOWLIST);
  for (const name of (process.env.WHAT_REGISTRY_DIST_TAG_ALLOWLIST || '').split(',')) {
    const trimmed = name.trim();
    if (trimmed) allowed.add(trimmed);
  }
  return allowed;
}

function verifyDistTag(packageSpecs, distTag) {
  const allowedUntagged = getDistTagAllowlist();
  const checks = [];
  for (const pkg of packageSpecs) {
    let actual = '';
    try {
      actual = retry(`npm dist-tag ${pkg.name}@${distTag}`, () => {
        const result = run('npm', ['view', pkg.name, `dist-tags.${distTag}`, '--json'], { capture: true });
        return parseNpmJsonString(result.stdout);
      });
    } catch {
      actual = '';
    }

    const isCurrentBackportPackage = /^0\.6\./.test(pkg.version);
    const isAllowlisted = allowedUntagged.has(pkg.name);
    const required = isCurrentBackportPackage && !isAllowlisted;
    checks.push({
      name: pkg.name,
      version: pkg.version,
      distTag,
      actual: actual || null,
      verified: actual === pkg.version,
      required,
      allowlisted: isAllowlisted,
      intentionallyUntagged: isAllowlisted && actual !== pkg.version,
    });

    if (required && actual !== pkg.version) {
      throw new Error(`Expected ${pkg.name} dist-tag ${distTag} to be ${pkg.version}, got ${actual || '<missing>'}`);
    }
  }
  return checks;
}

function parseNpmJsonString(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return text.replace(/^"|"$/g, '');
  }
}

function retry(label, fn) {
  const attempts = Number.parseInt(process.env.WHAT_REGISTRY_SMOKE_RETRIES || '6', 10);
  const delayMs = Number.parseInt(process.env.WHAT_REGISTRY_SMOKE_RETRY_MS || '5000', 10);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(`[registry-smoke] ${label} failed on attempt ${attempt}/${attempts}; retrying in ${delayMs}ms`);
      sleep(delayMs);
    }
  }
  throw lastError;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
