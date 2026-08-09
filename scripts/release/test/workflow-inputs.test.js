// A `${{ ... }}` expression inside a `run:` script is substituted before bash
// parses the line, so a workflow_dispatch input becomes command execution in a
// step that holds NPM_TOKEN. Inputs must travel through `env:` instead, and
// npm_tag must be validated before any secret-bearing step runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const workflows = [
  '.github/workflows/release-and-deploy.yml',
  '.depot/workflows/release-and-deploy.yml',
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

for (const file of workflows.slice(0, 2)) {
  test(`${file} validates npm_tag and passes it through env`, () => {
    const source = readFileSync(resolve(repoRoot, file), 'utf8');
    assert.match(source, /Validate npm dist-tag input/);
    assert.match(source, /NPM_TAG: \$\{\{ inputs\.npm_tag \}\}/);
    assert.match(source, /--tag "\$NPM_TAG"/);
  });
}
