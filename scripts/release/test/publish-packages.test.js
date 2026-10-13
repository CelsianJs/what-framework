// Regression tests for scripts/publish-packages.mjs. PACKAGE_ORDER is
// topological, so a mid-run failure used to keep publishing dependents against
// a version that never reached the registry. Provenance must be requested on
// an OIDC-capable runner and nowhere else.
//
// npm is stubbed on PATH: `npm view` reports "not published", `npm publish`
// records its argv (and can be told to fail for one package).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../../..');
const script = resolve(repoRoot, 'scripts/publish-packages.mjs');

function runPublish({ failIn = '', env = {}, args = [], published = [], tags = {}, failTagIn = '', failTagLookupIn = '', viewError = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-packages-'));
  const log = join(dir, 'publish.log');
  const npm = join(dir, 'npm');
  writeFileSync(npm, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = JSON.parse(process.env.MOCK_REGISTRY);
if (args[0] === 'view') {
  if (args[2] === 'dist-tags') {
    if (args[1] === state.failTagLookupIn) process.exit(1);
    console.log(JSON.stringify(state.tags[args[1]] || {})); process.exit(0);
  }
  if (state.viewError) { console.error(JSON.stringify({error: {code: state.viewError}})); process.exit(1); }
  const name = args[1].split('@')[0];
  if (state.published.includes(name)) { console.log(JSON.stringify(args[1].split('@')[1])); process.exit(0); }
  console.error(JSON.stringify({error: {code: 'E404'}})); process.exit(1);
}
if (args[0] === 'publish') {
  fs.appendFileSync(process.env.MOCK_LOG, process.cwd() + ' ' + args.join(' ') + '\\n');
  if (state.failIn && process.cwd().endsWith(state.failIn)) process.exit(1);
  process.exit(0);
}
if (args[0] === 'dist-tag') {
  fs.appendFileSync(process.env.MOCK_LOG, args.join(' ') + '\\n');
  if (args[2].startsWith(state.failTagIn + '@')) process.exit(1);
  process.exit(0);
}
process.exit(1);
`);
  chmodSync(npm, 0o755);
  writeFileSync(log, '');

  try {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        NODE_AUTH_TOKEN: 'stub-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: '',
        MOCK_LOG: log,
        MOCK_REGISTRY: JSON.stringify({ failIn, published, tags, failTagIn, failTagLookupIn, viewError }),
        ...env,
      },
    });
    return { result, lines: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a failed publish aborts the remaining packages instead of continuing', () => {
  const { result, lines } = runPublish({ failIn: 'packages/core' });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(lines.length, 1, `expected to stop after the first failure, got:\n${lines.join('\n')}`);
  assert.match(lines[0], /packages\/core /);
  assert.match(result.stderr, /Aborting/);
  // The exact count tracks however many public packages exist, so assert the
  // property that matters: everything after the failure was aborted.
  const abortedSection = result.stdout.slice(result.stdout.indexOf('  aborted: '));
  const aborted = Number(/aborted: (\d+)/.exec(abortedSection)?.[1]);
  assert.ok(aborted > 0, `expected the remaining packages to be aborted, got:\n${result.stdout}`);
  assert.equal(
    aborted,
    (abortedSection.match(/^ {4}- /gm) || []).length,
    'every aborted package must be listed individually',
  );
});

test('publishes carry --provenance on an OIDC-capable runner', () => {
  const { result, lines } = runPublish({
    env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.invalid/token' },
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(lines.length > 1);
  for (const line of lines.filter(line => line.includes(' publish '))) assert.match(line, /--provenance/);
});

test('publishes omit --provenance without an OIDC token endpoint', () => {
  const { result, lines } = runPublish();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(lines.length > 1);
  for (const line of lines.filter(line => line.includes(' publish '))) assert.doesNotMatch(line, /--provenance/);
});

const maintained = ['what-core', 'what-text', 'what-router', 'what-server', 'what-isr', 'what-compiler', 'what-devtools', 'what-devtools-mcp', 'eslint-plugin-what', 'what-react', 'what-framework', 'what-framework-cli', 'create-what'];
const version = JSON.parse(readFileSync(join(repoRoot, 'packages/core/package.json'))).version;

test('an already-published next cohort is explicitly promoted to latest', () => {
  const tags = Object.fromEntries(maintained.map(name => [name, { next: version, latest: '0.1.0' }]));
  const { result, lines } = runPublish({ published: maintained, tags });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lines.length, maintained.length);
  for (const name of maintained) assert.ok(lines.includes(`dist-tag add ${name}@${version} latest`));
  assert.ok(!lines.some(line => line.includes(' publish ')));
});

test('matching requested tags are idempotent and do not republish or retag', () => {
  const tags = Object.fromEntries(maintained.map(name => [name, { next: version }]));
  const { result, lines } = runPublish({ published: maintained, tags, args: ['--tag', 'next'] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines, []);
});

test('partial cohort recovery publishes missing versions before promoting existing versions', () => {
  const { result, lines } = runPublish({ published: ['what-core', 'what-text'], args: ['--tag', 'next'] });
  assert.equal(result.status, 0, result.stderr);
  const publishes = lines.filter(line => line.includes(' publish '));
  assert.equal(publishes.length, maintained.length - 2);
  assert.ok(publishes.every(line => line.includes('--tag next')));
  assert.ok(lines.indexOf(`dist-tag add what-core@${version} next`) > lines.indexOf(publishes.at(-1)));
});

test('a partial cohort publish failure never promotes the existing versions', () => {
  const { result, lines } = runPublish({ published: ['what-core'], failIn: 'packages/router' });
  assert.equal(result.status, 1);
  assert.ok(!lines.some(line => line.startsWith('dist-tag')));
  assert.ok(!lines.some(line => line.includes('packages/server publish')));
});

test('tag update failures stop subsequent promotions and fail the release', () => {
  const { result, lines } = runPublish({ published: maintained, failTagIn: 'what-text' });
  assert.equal(result.status, 1);
  assert.deepEqual(lines, [`dist-tag add what-core@${version} latest`, `dist-tag add what-text@${version} latest`]);
});

test('an unavailable cohort tag lookup refuses all promotions', () => {
  const { result, lines } = runPublish({ published: maintained, failTagLookupIn: 'what-text' });
  assert.equal(result.status, 1);
  assert.deepEqual(lines, []);
  assert.match(result.stderr, /Could not read dist-tags/);
});

test('registry probe failures are not mistaken for absent versions', () => {
  const { result, lines } = runPublish({ viewError: 'E503' });
  assert.equal(result.status, 1);
  assert.deepEqual(lines, []);
  assert.match(result.stderr, /Could not determine whether/);
});

test('dry runs plan missing requested tags without changing the registry', () => {
  const { result, lines } = runPublish({ published: maintained, args: ['--dry-run', '--tag', 'next'] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines, []);
  assert.match(result.stdout, /Would tag .* next/);
});

test('invalid tags fail before any registry mutation', () => {
  for (const tag of ['--access', 'beta release', '1.2.3']) {
    const { result, lines } = runPublish({ args: ['--tag', tag] });
    assert.equal(result.status, 1, tag);
    assert.deepEqual(lines, []);
    assert.match(result.stderr, /Invalid npm dist-tag/);
  }
});
