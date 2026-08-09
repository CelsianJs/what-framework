// Scaffolds shipped a Vite plugin that hard-requires `what-devtools` without
// ever installing it (every new project logged "not installed - skipping
// DevTools/MCP dev injection"), a tsconfig with no typescript dependency, and
// one CLAUDE.md that told full-stack agents to write JSX the buildless
// template cannot compile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');
const meta = JSON.parse(await readFile(resolve(repoRoot, 'packages/create-what/package.json'), 'utf8'));
const expectedRange = `^${meta.version}`;

async function scaffold(name, args = []) {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-tooling-'));
  const result = spawnSync(process.execPath, [createWhat, name, ...args, '--yes'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { cwd, root: join(cwd, name) };
}

test('the SPA scaffold installs the devtools bridge the MCP vite plugin needs', async () => {
  const { cwd, root } = await scaffold('spa-app');
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.devDependencies['what-devtools'], expectedRange);
    assert.equal(pkg.devDependencies['what-devtools-mcp'], expectedRange);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a scaffolded tsconfig comes with typescript and a typecheck script', async () => {
  const { cwd, root } = await scaffold('ts-app');
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await readFile(join(root, 'tsconfig.json'), 'utf8');
    assert.ok(pkg.devDependencies.typescript, 'typescript must be a devDependency');
    assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the full-stack CLAUDE.md does not tell agents to write JSX', async () => {
  const spa = await scaffold('spa-claude');
  const full = await scaffold('fs-claude', ['--fullstack']);
  try {
    const spaDoc = await readFile(join(spa.root, 'CLAUDE.md'), 'utf8');
    const fullDoc = await readFile(join(full.root, 'CLAUDE.md'), 'utf8');

    assert.notEqual(
      spaDoc.replace('spa-claude', ''),
      fullDoc.replace('fs-claude', ''),
      'the two templates must not ship identical agent instructions',
    );
    assert.match(fullDoc, /no compiler and no JSX/);
    assert.match(fullDoc, /h\('p', \{\}, \(\) =>/);
    assert.match(spaDoc, /what-compiler/);
  } finally {
    await rm(spa.cwd, { recursive: true, force: true });
    await rm(full.cwd, { recursive: true, force: true });
  }
});

test('the full-stack tsconfig does not require vite types it never installs', async () => {
  const { cwd, root } = await scaffold('fs-ts', ['--fullstack']);
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const tsconfig = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
    assert.equal(pkg.devDependencies.vite, undefined);
    assert.equal(tsconfig.compilerOptions.types, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
