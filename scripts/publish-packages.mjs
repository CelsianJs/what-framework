#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PACKAGE_ORDER = [
  'packages/core',
  'packages/router',
  'packages/server',
  'packages/compiler',
  'packages/what',
  'packages/create-what',
  'packages/cli',
];

const options = parseArgs(process.argv.slice(2));

if (!options.dryRun && !process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
  const authProbe = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
  if (authProbe.status !== 0) {
    console.error('[release] Missing npm auth. Set NODE_AUTH_TOKEN/NPM_TOKEN or run `npm login`.');
    process.exit(1);
  }
}

console.log('[release] Publish plan');
console.log(`  dry-run: ${options.dryRun ? 'yes' : 'no'}`);
console.log(`  tag: ${options.tag}`);
console.log('');

const summary = {
  published: [],
  skipped: [],
  failed: [],
};

for (const relDir of PACKAGE_ORDER) {
  const pkgDir = join(repoRoot, relDir);
  const pkgFile = join(pkgDir, 'package.json');

  if (!existsSync(pkgFile)) {
    console.warn(`[release] Skipping ${relDir}: missing package.json`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const name = pkg.name;
  const version = pkg.version;

  if (!name || !version) {
    console.error(`[release] Invalid package metadata in ${pkgFile}`);
    summary.failed.push(`${relDir} (invalid package metadata)`);
    continue;
  }

  if (pkg.private) {
    console.log(`[release] Skip ${name}@${version}: private package`);
    summary.skipped.push(`${name}@${version} (private)`);
    continue;
  }

  const spec = `${name}@${version}`;

  if (isVersionPublished(spec)) {
    console.log(`[release] Skip ${spec}: already published`);
    summary.skipped.push(`${spec} (already published)`);
    continue;
  }

  console.log(`[release] Publishing ${spec} from ${relDir}`);

  const publishArgs = ['publish', '--access', 'public'];
  if (options.tag && options.tag !== 'latest') {
    publishArgs.push('--tag', options.tag);
  }
  if (options.otp) {
    publishArgs.push('--otp', options.otp);
  }
  if (options.dryRun) {
    publishArgs.push('--dry-run');
  }

  const result = run('npm', publishArgs, { cwd: pkgDir });
  if (result.status === 0) {
    summary.published.push(spec);
  } else {
    summary.failed.push(spec);
    console.error(`[release] Failed publishing ${spec}`);
  }
}

console.log('\n[release] Publish summary');
console.log(`  published: ${summary.published.length}`);
for (const item of summary.published) console.log(`    - ${item}`);
console.log(`  skipped: ${summary.skipped.length}`);
for (const item of summary.skipped) console.log(`    - ${item}`);
console.log(`  failed: ${summary.failed.length}`);
for (const item of summary.failed) console.log(`    - ${item}`);

if (summary.failed.length > 0) {
  process.exit(1);
}

function parseArgs(args) {
  const options = { dryRun: false, tag: 'latest', otp: '' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--tag') {
      const value = args[i + 1];
      if (!value) {
        usage('--tag requires a value');
      }
      options.tag = value;
      i += 1;
      continue;
    }
    if (arg === '--otp') {
      const value = args[i + 1];
      if (!value) {
        usage('--otp requires a value');
      }
      options.otp = value;
      i += 1;
      continue;
    }
    usage(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage(message) {
  if (message) console.error(`[release] ${message}`);
  console.error('Usage: node scripts/publish-packages.mjs [--dry-run] [--tag <dist-tag>] [--otp <code>]');
  process.exit(1);
}

function isVersionPublished(spec) {
  const res = spawnSync('npm', ['view', spec, 'version', '--json'], {
    encoding: 'utf8',
  });
  return res.status === 0;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
}
