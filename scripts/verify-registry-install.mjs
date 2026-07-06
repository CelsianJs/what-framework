#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { retryWithBackoff } from './lib/retry.mjs';

const packages = [
  'what-core',
  'what-text',
  'what-router',
  'what-server',
  'what-isr',
  'what-compiler',
  'what-devtools',
  'what-mcp',
  'what-devtools-mcp',
  'eslint-plugin-what',
  'what-react',
  'what-framework',
  'what-framework-cli',
  'create-what',
];

const root = process.cwd();
const version = process.env.WHAT_REGISTRY_VERSION || readVersion();
// Default to pinning the exact expected version rather than resolving
// `@latest`. Right after a publish, npm's dist-tag update and the CDN
// serving the tarball can both lag by a few minutes; resolving `@latest`
// during that window can either 404 OR silently resolve to the *previous*
// version, which would let this check pass without ever having verified the
// release that was just published. Pinning to the version we just bumped to
// (and combining it with the retry below) verifies the actual release.
// `WHAT_REGISTRY_TAG` remains available for an explicit opt-in to dist-tag
// verification (e.g. confirming `latest` was moved correctly).
const tag = process.env.WHAT_REGISTRY_TAG || '';
const selector = tag || version;
const artifactPath = process.env.WHAT_REGISTRY_SMOKE_ARTIFACT || 'artifacts/registry-smoke.json';
const completedChecks = [];
const retryLog = [];

// npm install right after publish reliably 404s for a short window while the
// registry/CDN propagates — see scripts/lib/retry.mjs. Retry only the two
// install calls that actually hit the registry; everything else here is
// local/deterministic and a failure there is a real bug, not lag.
const RETRY_ATTEMPTS = envInt('WHAT_REGISTRY_RETRY_ATTEMPTS', 5);
const RETRY_DELAYS_MS = envDelays('WHAT_REGISTRY_RETRY_DELAYS_MS', [30_000, 60_000, 90_000, 120_000]);

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envDelays(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length ? parsed : fallback;
}

function readVersion() {
  const res = run(process.execPath, ['-p', "JSON.parse(require('node:fs').readFileSync('packages/core/package.json','utf8')).version"], { cwd: root });
  return res.stdout.trim();
}

function packageSpec(name) {
  return `${name}@${selector}`;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    encoding: 'utf8',
    stdio: opts.stdio ?? 'pipe',
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  if (res.status !== 0) {
    const details = [res.stdout, res.stderr].filter(Boolean).join('\n');
    throw new Error(`${cmd} ${args.join(' ')} failed with ${res.status}\n${details}`);
  }
  return res;
}

// Wraps a registry-hitting `npm install` in retry-with-backoff. Only for the
// two call sites that install from the live registry right after publish —
// see the RETRY_ATTEMPTS/RETRY_DELAYS_MS comment above for why.
async function runInstallWithRetry(cmd, args, opts, label) {
  return retryWithBackoff(
    () => run(cmd, args, opts),
    {
      attempts: RETRY_ATTEMPTS,
      delaysMs: RETRY_DELAYS_MS,
      onRetry: ({ attempt, attempts, delayMs, error }) => {
        const note = `${label}: attempt ${attempt}/${attempts} failed (likely npm registry propagation lag), retrying in ${Math.round(delayMs / 1000)}s`;
        console.warn(`[verify-registry] ${note}\n${error.message}`);
        retryLog.push({ label, attempt, attempts, delayMs, error: error.message });
      },
    },
  );
}

function binPath(cwd, bin) {
  return join(cwd, 'node_modules', '.bin', bin);
}

function assertBin(cwd, bin) {
  const file = binPath(cwd, bin);
  if (!existsSync(file)) throw new Error(`Expected installed binary ${bin} at ${file}`);
  return realpathSync(file);
}

function assertHelp(cwd, bin) {
  const res = run(process.execPath, [assertBin(cwd, bin), '--help'], { cwd });
  const output = `${res.stdout}\n${res.stderr}`;
  if (!/Usage|Commands|Options|what-/i.test(output)) {
    throw new Error(`${bin} --help did not print expected help text`);
  }
}

async function writeArtifact(status, specs, extra = {}) {
  const artifact = {
    status,
    generatedAt: new Date().toISOString(),
    packageCount: specs.length,
    packages: specs,
    checks: completedChecks,
    retries: retryLog,
    ...extra,
  };
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

const tmp = await mkdtemp(join(tmpdir(), 'what-registry-smoke-'));
let specs = [];
try {
  specs = packages.map(packageSpec);
  run('npm', ['init', '-y'], { cwd: tmp });
  await runInstallWithRetry(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...specs],
    { cwd: tmp },
    'npm install (registry packages)',
  );
  completedChecks.push('npm install --ignore-scripts --no-audit --no-fund');

  const importCheck = `
    await import('what-core');
    await import('what-text');
    await import('what-router');
    await import('what-server');
    await import('what-isr');
    await import('what-compiler');
    await import('what-devtools');
    await import('eslint-plugin-what');
    await import('what-react');
    await import('what-framework');
    console.log('WHAT_REGISTRY_IMPORT_OK');
  `;
  const imported = run(process.execPath, ['--input-type=module', '-e', importCheck], { cwd: tmp });
  if (!imported.stdout.includes('WHAT_REGISTRY_IMPORT_OK')) {
    throw new Error('Registry import smoke did not complete');
  }
  completedChecks.push('esm imports');

  assertHelp(tmp, 'what');
  assertHelp(tmp, 'create-what');
  assertHelp(tmp, 'what-devtools-mcp');
  assertHelp(tmp, 'what-mcp');
  completedChecks.push('installed CLI/MCP bins help');

  const createWhatBin = assertBin(tmp, 'create-what');
  run(process.execPath, [createWhatBin, 'registry-smoke-app', '--yes'], { cwd: tmp });
  completedChecks.push('create-what --yes');

  const appDir = join(tmp, 'registry-smoke-app');
  await runInstallWithRetry(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: appDir },
    'npm install (generated app)',
  );
  run('npm', ['run', 'build'], { cwd: appDir });
  completedChecks.push('generated app install/build');

  await writeArtifact('passed', specs);
  console.log(`OK: registry smoke installed/imported ${specs.length} What Framework package(s), checked bins, and built a generated app`);
} catch (err) {
  await writeArtifact('failed', specs, {
    error: err instanceof Error ? err.message : String(err),
  });
  throw err;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
