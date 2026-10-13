// A `${{ ... }}` expression inside a `run:` script is substituted before bash
// parses the line, so a workflow_dispatch input becomes command execution in a
// step that holds NPM_TOKEN. Inputs must travel through `env:` instead, and
// npm_tag must be validated before any secret-bearing step runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../../..');
// `release-and-deploy` deliberately has no Depot counterpart. Everything else
// is mirrored, Depot copy first.
const releaseWorkflows = ['.github/workflows/release-and-deploy.yml'];
const workflows = [
  ...releaseWorkflows,
  '.github/workflows/ci.yml',
  '.depot/workflows/ci.yml',
  '.github/workflows/benchmarks.yml',
  '.depot/workflows/benchmarks.yml',
  '.github/workflows/size.yml',
  '.depot/workflows/size.yml',
];

function runScriptLines(source) {
  const lines = source.split('\n');
  const collected = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i].match(/^(\s*)run: [|>]/);
    if (!start) continue;
    const indent = start[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') continue;
      if (line.search(/\S/) <= indent) break;
      collected.push(line);
    }
  }
  return collected;
}

for (const file of workflows) {
  test(`${file} never interpolates expressions into a run script`, () => {
    const source = readFileSync(resolve(repoRoot, file), 'utf8');
    for (const line of runScriptLines(source)) {
      assert.doesNotMatch(line, /\$\{\{/, `expression substituted into shell: ${line.trim()}`);
    }
  });
}

for (const file of releaseWorkflows) {
  test(`${file} validates npm_tag and passes it through env`, () => {
    const source = readFileSync(resolve(repoRoot, file), 'utf8');
    assert.match(source, /Validate npm dist-tag input/);
    assert.match(source, /NPM_TAG: \$\{\{ inputs\.npm_tag \}\}/);
    assert.match(source, /--tag "\$NPM_TAG"/);
  });
}

// A Depot copy of the publisher resolves `secrets.NPM_TOKEN` to an empty string
// and dies at the publish step with "Missing npm auth" — after running every
// quality gate green for ten minutes. It also cannot mint npm provenance, which
// comes from GitHub's OIDC issuer. The first 0.13.0 publish attempt was lost to
// exactly this. Publishing belongs to GitHub Actions alone.
test('the publisher has no Depot counterpart', () => {
  assert.equal(
    existsSync(resolve(repoRoot, '.depot/workflows/release-and-deploy.yml')),
    false,
    'a Depot copy of release-and-deploy.yml cannot publish: no NPM_TOKEN, no provenance',
  );
});

test('the release ref is checked before any credential-bearing step', () => {
  const source = readFileSync(resolve(repoRoot, releaseWorkflows[0]), 'utf8');
  assert.match(source, /Require main release ref[\s\S]*GITHUB_REF.*refs\/heads\/main/);
  assert.ok(source.indexOf('Require main release ref') < source.indexOf('secrets.NPM_TOKEN', source.indexOf('steps:')));
  assert.match(source, /WHAT_REGISTRY_TAG: \$\{\{ inputs\.npm_tag \}\}/);
  const guard = source.match(/- name: Require main release ref\n\s+run: \|\n([\s\S]*?)(?=\n\s+- name:|\n\s+#)/)?.[1];
  assert.ok(guard, 'the main-ref guard must be an executable first step');
  for (const ref of ['refs/heads/main', 'refs/heads/feature/release', 'refs/tags/v0.13.10', '']) {
    const result = spawnSync('bash', ['-e', '-c', guard], { encoding: 'utf8', env: { GITHUB_REF: ref } });
    assert.equal(result.status, ref === 'refs/heads/main' ? 0 : 1, ref);
  }
});
