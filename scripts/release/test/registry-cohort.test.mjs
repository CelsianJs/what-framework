import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const maintained = ['what-core', 'what-text', 'what-router', 'what-server', 'what-isr', 'what-compiler', 'what-devtools', 'what-devtools-mcp', 'eslint-plugin-what', 'what-react', 'what-framework', 'what-framework-cli', 'create-what'];
const version = JSON.parse(readFileSync(join(root, 'packages/core/package.json'))).version;

test('registry verification checks exact versions as well as the requested tag for every package', async () => {
  const { verifyRegistryCohort } = await import('../registry-cohort.mjs');
  const calls = [];
  const packages = ['what-core', 'create-what'];
  verifyRegistryCohort({ packages, version: '0.13.10', tag: 'next', run: args => {
    calls.push(args);
    return { stdout: JSON.stringify(args.includes('dist-tags') ? { next: '0.13.10', latest: '0.13.9' } : '0.13.10') };
  } });
  for (const name of packages) {
    assert.ok(calls.some(args => args.includes(`${name}@0.13.10`) && args.includes('version')));
    assert.ok(calls.some(args => args.includes(name) && args.includes('dist-tags')));
  }
});

test('a correct exact version cannot hide a stale requested tag', async () => {
  const { verifyRegistryCohort } = await import('../registry-cohort.mjs');
  assert.throws(() => verifyRegistryCohort({ packages: ['what-core'], version: '0.13.10', tag: 'latest', run: args => ({ stdout: JSON.stringify(args.includes('dist-tags') ? { latest: '0.13.9' } : '0.13.10') }) }), /what-core.*latest.*0.13.9.*0.13.10/);
});

test('a correct requested tag cannot hide the wrong exact-version response', async () => {
  const { verifyRegistryCohort } = await import('../registry-cohort.mjs');
  assert.throws(() => verifyRegistryCohort({ packages: ['what-core'], version: '0.13.10', tag: 'next', run: args => ({ stdout: JSON.stringify(args.includes('dist-tags') ? { next: '0.13.10' } : '0.13.9') }) }), /what-core@0.13.10.*0.13.9/);
});

test('the consumer always installs the pinned version and defaults to verifying latest', async () => {
  const source = readFileSync(new URL('../../verify-registry-install.mjs', import.meta.url), 'utf8');
  assert.match(source, /WHAT_REGISTRY_TAG \|\| 'latest'/);
  assert.match(source, /return `\$\{name\}@\$\{version\}`/);
  assert.match(source, /verifyRegistryCohort\(/);
});

function runVerifier({ staleTag = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'registry-cohort-test-'));
  const artifact = join(dir, 'smoke.json');
  const log = join(dir, 'npm.jsonl');
  try {
    const npm = join(dir, 'npm');
    writeFileSync(npm, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_REGISTRY_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'view') {
  console.log(JSON.stringify(args[2] === 'dist-tags' ? {next: process.env.MOCK_STALE_TAG === '1' ? '0.1.0' : process.env.MOCK_VERSION} : process.env.MOCK_VERSION));
}
// Install is deliberately a no-op: imports will fail after metadata/pinned
// install assertions, without pulling or executing any registry code.
`);
    chmodSync(npm, 0o755);
    const result = spawnSync(process.execPath, [join(root, 'scripts/verify-registry-install.mjs')], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`, WHAT_REGISTRY_TAG: 'next', WHAT_REGISTRY_VERSION: version,
        WHAT_REGISTRY_RETRY_ATTEMPTS: '1', WHAT_REGISTRY_SMOKE_ARTIFACT: artifact,
        MOCK_REGISTRY_LOG: log, MOCK_VERSION: version, MOCK_STALE_TAG: staleTag ? '1' : '0',
      },
    });
    return { result, artifact: JSON.parse(readFileSync(artifact)), calls: readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a stale requested tag fails the full verifier before an install', () => {
  const { result, artifact, calls } = runVerifier({ staleTag: true });
  assert.equal(result.status, 1);
  assert.match(artifact.error, /what-core.*next.*0.1.0/);
  assert.equal(artifact.tag, 'next');
  assert.ok(!calls.some(args => args[0] === 'install'));
});

test('the full verifier checks all 13 maintained members and installs exact versions under a custom tag', () => {
  const { artifact, calls } = runVerifier();
  const installed = calls.find(args => args[0] === 'install');
  assert.ok(installed, artifact.error);
  assert.deepEqual(installed.filter(arg => arg.includes('@')), maintained.map(name => `${name}@${version}`));
  assert.equal(calls.filter(args => args[0] === 'view').length, 26);
  assert.ok(!calls.some(args => args.some(arg => arg.startsWith('what-mcp'))));
  assert.equal(artifact.checks[0], 'exact registry versions and dist-tag next');
  assert.equal(artifact.packageCount, 13);
});
