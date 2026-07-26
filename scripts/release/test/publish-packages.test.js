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

function runPublish({ failIn = '', env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-packages-'));
  const log = join(dir, 'publish.log');
  const npm = join(dir, 'npm');
  const failCheck = failIn
    ? `case "$PWD" in\n    *"${failIn}") exit 1 ;;\n  esac\n  `
    : '';
  writeFileSync(npm, `#!/bin/sh
if [ "$1" = "publish" ]; then
  echo "$PWD $*" >> "${log}"
  ${failCheck}exit 0
fi
exit 1
`);
  chmodSync(npm, 0o755);
  writeFileSync(log, '');

  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        NODE_AUTH_TOKEN: 'stub-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: '',
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
  for (const line of lines) assert.match(line, /--provenance/);
});

test('publishes omit --provenance without an OIDC token endpoint', () => {
  const { result, lines } = runPublish();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.doesNotMatch(line, /--provenance/);
});
