#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const DEFAULT_TARGETS = [
  'sites/benchmarks',
  'docs-site',
  'docs-site/docs',
  'sites/react-compat',
];

const options = parseArgs(process.argv.slice(2));

if (!process.env.VERCEL_TOKEN) {
  const authProbe = spawnSync('npx', ['--yes', 'vercel', 'whoami'], { encoding: 'utf8' });
  if (authProbe.status !== 0) {
    console.error('[deploy] Missing Vercel auth. Set VERCEL_TOKEN or run `vercel login`.');
    process.exit(1);
  }
}

const targets = options.targets.length > 0 ? options.targets : DEFAULT_TARGETS;

console.log('[deploy] Vercel deploy plan');
console.log(`  dry-run: ${options.dryRun ? 'yes' : 'no'}`);
console.log(`  targets: ${targets.join(', ')}`);
console.log('');

const failed = [];

for (const target of targets) {
  const absTarget = resolve(repoRoot, target);
  const linkFile = join(absTarget, '.vercel', 'project.json');

  if (!existsSync(absTarget)) {
    console.error(`[deploy] Missing target directory: ${target}`);
    failed.push(target);
    continue;
  }

  if (!existsSync(linkFile)) {
    console.error(`[deploy] Missing Vercel link file: ${target}/.vercel/project.json`);
    failed.push(target);
    continue;
  }

  const projectMeta = JSON.parse(readFileSync(linkFile, 'utf8'));
  const projectName = projectMeta.projectName || '(unknown)';
  console.log(`[deploy] ${target} -> ${projectName}`);

  if (options.dryRun) {
    continue;
  }

  const deployArgs = ['--yes', 'vercel', 'deploy', '--prod', '--yes', '--cwd', absTarget];
  if (process.env.VERCEL_TOKEN) {
    deployArgs.push('--token', process.env.VERCEL_TOKEN);
  }

  const result = run('npx', deployArgs);
  if (result.status !== 0) {
    failed.push(target);
    console.error(`[deploy] Failed target: ${target}`);
  }
}

if (failed.length > 0) {
  console.error('\n[deploy] Failed targets:');
  for (const target of failed) {
    console.error(`  - ${target}`);
  }
  process.exit(1);
}

console.log('\n[deploy] All targets deployed successfully.');

function parseArgs(args) {
  const options = {
    dryRun: false,
    targets: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--targets') {
      const value = args[i + 1];
      if (!value) usage('--targets requires a value');
      options.targets = value.split(',').map((v) => v.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    usage(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage(message) {
  if (message) console.error(`[deploy] ${message}`);
  console.error('Usage: node scripts/deploy-vercel.mjs [--dry-run] [--targets "dir1,dir2"]');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
}
