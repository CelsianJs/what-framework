#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PACKAGE_ORDER = [
  'packages/core',
  'packages/what-text',
  'packages/router',
  'packages/server',
  'packages/cache',
  'packages/compiler',
  'packages/devtools',
  // packages/mcp-server (what-mcp) is deliberately absent: it is deprecated on
  // npm in favour of what-devtools-mcp and is frozen at the version it last
  // shipped. See FROZEN_PACKAGES in scripts/bump-version.mjs.
  'packages/devtools-mcp',
  'packages/eslint-plugin',
  'packages/react-compat',
  'packages/what',
  'packages/cli',
  'packages/create-what',
];

const options = parseArgs(process.argv.slice(2));

// Refuse an incomplete/mixed local cohort before any registry mutation. The
// frozen documentation MCP is deliberately outside PACKAGE_ORDER.
const cohort = PACKAGE_ORDER.map(relDir => {
  const pkgFile = join(repoRoot, relDir, 'package.json');
  if (!existsSync(pkgFile)) throw new Error(`[release] Missing cohort manifest: ${relDir}`);
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  if (!pkg.name || !pkg.version || pkg.private) throw new Error(`[release] Invalid public cohort manifest: ${relDir}`);
  return { relDir, pkg };
});
if (new Set(cohort.map(({ pkg }) => pkg.version)).size !== 1) {
  throw new Error('[release] Maintained package versions must match before publishing.');
}

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
  aborted: [],
  tagged: [],
};
const tagCandidates = [];

// npm provenance requires an OIDC-capable CI runner (id-token: write). Local
// and dry-run publishes have no token endpoint, so the flag must stay off.
const useProvenance = !options.dryRun && Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);

for (const [index, { relDir, pkg }] of cohort.entries()) {
  const pkgDir = join(repoRoot, relDir);
  const name = pkg.name;
  const version = pkg.version;

  const spec = `${name}@${version}`;

  let published;
  try {
    published = isVersionPublished(spec);
  } catch (error) {
    console.error(error.message);
    summary.failed.push(spec);
    abortRemaining(index);
    break;
  }
  if (published) {
    console.log(`[release] Skip ${spec}: already published`);
    summary.skipped.push(`${spec} (already published)`);
    tagCandidates.push({ name, spec });
    continue;
  }

  console.log(`[release] Publishing ${spec} from ${relDir}`);

  const publishArgs = ['publish', '--access', 'public'];
  if (useProvenance) {
    publishArgs.push('--provenance');
  }
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
  if (result.status !== 0) {
    summary.failed.push(spec);
    console.error(`[release] Failed publishing ${spec}`);
    abortRemaining(index);
    break;
  }
  summary.published.push(spec);
}

// npm cannot roll a cohort back. Complete every missing version first, then
// promote existing versions explicitly instead of silently skipping their tag.
const tagPlans = [];
if (summary.failed.length === 0) {
  for (const [index, { name, spec }] of tagCandidates.entries()) {
    const viewed = spawnSync('npm', ['view', name, 'dist-tags', '--json'], { encoding: 'utf8' });
    let tags;
    try {
      if (viewed.status !== 0) throw new Error('registry lookup failed');
      tags = JSON.parse(viewed.stdout);
      if (!tags || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('invalid dist-tags response');
    } catch {
      console.error(`[release] Could not read dist-tags for ${name}; refusing promotion.`);
      summary.failed.push(`${spec} (tag lookup)`);
      summary.aborted.push(...tagCandidates.slice(index + 1).map(candidate => `${candidate.spec} (tag)`));
      break;
    }
    const version = spec.slice(name.length + 1);
    if (tags[options.tag] !== version) tagPlans.push({ name, spec });
  }
}
// Resolve the entire promotion plan before the first write. An unavailable
// registry lookup must not leave half of the existing cohort promoted.
if (summary.failed.length === 0) {
  for (const [index, { name, spec }] of tagPlans.entries()) {
    if (options.dryRun) {
      console.log(`[release] Would tag ${spec} ${options.tag}`);
      continue;
    }
    const args = ['dist-tag', 'add', spec, options.tag];
    if (options.otp) args.push('--otp', options.otp);
    const tagged = run('npm', args);
    if (tagged.status !== 0) {
      console.error(`[release] Failed setting ${name} dist-tag ${options.tag}`);
      summary.failed.push(`${spec} (tag ${options.tag})`);
      summary.aborted.push(...tagPlans.slice(index + 1).map(candidate => `${candidate.spec} (tag)`));
      break;
    }
    summary.tagged.push(`${spec} -> ${options.tag}`);
  }
}

console.log('\n[release] Publish summary');
console.log(`  published: ${summary.published.length}`);
for (const item of summary.published) console.log(`    - ${item}`);
console.log(`  skipped: ${summary.skipped.length}`);
for (const item of summary.skipped) console.log(`    - ${item}`);
console.log(`  tagged: ${summary.tagged.length}`);
for (const item of summary.tagged) console.log(`    - ${item}`);
console.log(`  failed: ${summary.failed.length}`);
for (const item of summary.failed) console.log(`    - ${item}`);
console.log(`  aborted: ${summary.aborted.length}`);
for (const item of summary.aborted) console.log(`    - ${item}`);

if (summary.failed.length > 0) {
  process.exit(1);
}

// PACKAGE_ORDER is topological: everything after a failure would publish
// against a dependency version that never reached the registry, and npm has
// no rollback. Stop instead of shipping an inconsistent release.
function abortRemaining(index) {
  const remaining = PACKAGE_ORDER.slice(index + 1);
  if (remaining.length === 0) return;
  console.error(`[release] Aborting: ${remaining.length} dependent package(s) left unpublished`);
  summary.aborted.push(...remaining);
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
  if (!/^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/.test(options.tag)) {
    usage(`Invalid npm dist-tag: ${options.tag}`);
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
  if (res.status === 0) {
    const expected = spec.slice(spec.lastIndexOf('@') + 1);
    try {
      if (JSON.parse(res.stdout) === expected) return true;
    } catch {
      // A malformed successful response must not be treated as a release.
    }
    throw new Error(`[release] Registry returned an unexpected version for ${spec}; refusing to publish.`);
  }
  try {
    const error = JSON.parse(res.stdout || res.stderr);
    if (error.error?.code === 'E404') return false;
  } catch {
    // A failed/ambiguous registry probe is not proof that a version is absent.
  }
  throw new Error(`[release] Could not determine whether ${spec} is published; refusing to publish.`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
}
