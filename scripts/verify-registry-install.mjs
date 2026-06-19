#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
const tag = process.env.WHAT_REGISTRY_TAG || 'latest';
const selector = process.env.WHAT_REGISTRY_VERSION ? version : tag;
const artifactPath = process.env.WHAT_REGISTRY_SMOKE_ARTIFACT || 'artifacts/registry-smoke.json';
const completedChecks = [];

function readVersion() {
  const res = run(process.execPath, ['-p', "JSON.parse(require('node:fs').readFileSync('packages/core/package.json','utf8')).version"], { cwd: root });
  return res.stdout.trim();
}

function packageSpec(name) {
  return process.env.WHAT_REGISTRY_VERSION ? `${name}@${version}` : `${name}@${selector}`;
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
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...specs], { cwd: tmp });
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
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: appDir });
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
