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
  'packages/devtools',
  'packages/mcp-server',
  'packages/devtools-mcp',
  'packages/eslint-plugin',
  'packages/react-compat',
  'packages/what',
  'packages/cli',
  'packages/create-what',
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
console.log(`  allow non-latest version: ${options.allowNonLatest ? 'yes' : 'no'}`);
console.log('');

const summary = {
  published: [],
  skipped: [],
  failed: [],
};

const publishQueue = [];

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
  const latest = getLatestVersion(name);
  if (latest.status === 'error') {
    console.error(`[release] Could not verify npm latest for ${name}: ${latest.message}`);
    summary.failed.push(`${spec} (npm latest lookup failed)`);
    continue;
  }
  if (latest.version && compareVersions(version, latest.version) <= 0) {
    if (options.tag === 'latest' || !options.allowNonLatest) {
      const guidance = options.tag === 'latest'
        ? `bump ${name} above npm latest ${latest.version} before publishing with --tag latest`
        : `pass --allow-non-latest to intentionally publish ${version} under non-latest tag "${options.tag}" (npm latest is ${latest.version})`;
      console.error(`[release] Version preflight failed for ${spec}: ${guidance}.`);
      summary.failed.push(`${spec} (npm latest is ${latest.version})`);
      continue;
    }
    console.warn(`[release] Non-latest publish allowed for ${spec}: npm latest is ${latest.version}, dist-tag is "${options.tag}"`);
  }

  if (latest.status === 'not_found') {
    console.warn(`[release] No npm latest found for ${name}; treating ${spec} as initial publish candidate`);
  }

  if (isVersionPublished(spec)) {
    console.log(`[release] Skip ${spec}: already published`);
    summary.skipped.push(`${spec} (already published)`);
    continue;
  }

  publishQueue.push({ relDir, pkgDir, spec });
}

if (summary.failed.length > 0) {
  console.error('\n[release] Refusing to publish because version preflight failed.');
  printSummary(summary, options);
  process.exit(1);
}

for (const { relDir, pkgDir, spec } of publishQueue) {
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

printSummary(summary, options);

if (summary.failed.length > 0) {
  process.exit(1);
}

function parseArgs(args) {
  const options = { dryRun: false, tag: 'latest', otp: '', allowNonLatest: false };
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
    if (arg === '--allow-non-latest') {
      options.allowNonLatest = true;
      continue;
    }
    usage(`Unknown argument: ${arg}`);
  }
  if (options.tag === 'latest' && options.allowNonLatest) {
    usage('--allow-non-latest can only be used with a non-latest --tag');
  }
  return options;
}

function usage(message) {
  if (message) console.error(`[release] ${message}`);
  console.error('Usage: node scripts/publish-packages.mjs [--dry-run] [--tag <dist-tag>] [--allow-non-latest] [--otp <code>]');
  process.exit(1);
}

function getLatestVersion(name) {
  const res = spawnSync('npm', ['view', `${name}@latest`, 'version', '--json'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    const output = `${res.stderr ?? ''}
${res.stdout ?? ''}`;
    if (/E404|404 Not Found|is not in this registry/i.test(output)) {
      return { status: 'not_found', version: '', message: output.trim() };
    }
    return { status: 'error', version: '', message: output.trim() || `npm exited with ${res.status}` };
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return { status: 'ok', version: typeof parsed === 'string' ? parsed : '', message: '' };
  } catch {
    return { status: 'ok', version: res.stdout.trim().replace(/^"|"$/g, ''), message: '' };
  }
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

function printSummary(summary, options) {
  console.log('\n[release] Publish summary');
  console.log(`  ${options.dryRun ? 'dry-run publish candidates' : 'published'}: ${summary.published.length}`);
  for (const item of summary.published) console.log(`    - ${item}`);
  console.log(`  skipped: ${summary.skipped.length}`);
  for (const item of summary.skipped) console.log(`    - ${item}`);
  console.log(`  failed: ${summary.failed.length}`);
  for (const item of summary.failed) console.log(`    - ${item}`);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] > pb.core[i]) return 1;
    if (pa.core[i] < pb.core[i]) return -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre, undefined, { numeric: true });
}

function parseVersion(version) {
  const [corePart, pre = ''] = String(version).split('-', 2);
  const core = corePart.split('.').map(part => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
  while (core.length < 3) core.push(0);
  return { core: core.slice(0, 3), pre };
}
