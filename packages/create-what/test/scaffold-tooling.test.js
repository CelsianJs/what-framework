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

// React compat and the CSS approach are SPA prompts; `answers` types them.
async function scaffoldSpa(name, answers) {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-tooling-'));
  const result = spawnSync(process.execPath, [createWhat, name, '--template=spa'], { cwd, input: answers, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { cwd, root: join(cwd, name) };
}

test('the StyleX scaffold uses a StyleX plugin npm installs next to its Vite', async () => {
  const { cwd, root } = await scaffoldSpa('stylex-app', 'n\n3\n');
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    // Every vite-plugin-stylex release peers on vite ^5, so npm refused it next
    // to the scaffold's Vite (ERESOLVE) without --legacy-peer-deps.
    assert.equal(pkg.devDependencies['vite-plugin-stylex'], undefined);
    assert.ok(pkg.devDependencies['@stylexjs/unplugin'], 'the official StyleX plugin');
    assert.equal(pkg.devDependencies['@stylexjs/unplugin'], pkg.devDependencies['@stylexjs/stylex'], 'plugin and runtime on one StyleX release');
    assert.match(await readFile(join(root, 'vite.config.js'), 'utf8'), /import stylex from '@stylexjs\/unplugin\/vite';[\s\S]*plugins: \[.*stylex\(\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the React-compat scaffold renders its signal as a function child the React component cannot reset', async () => {
  const { cwd, root } = await scaffoldSpa('compat-app', 'y\n1\n');
  try {
    const main = await readFile(join(root, 'src', 'main.jsx'), 'utf8');
    assert.match(main, /^const count = signal\(0, 'count'\);$/m, 'the signal lives outside the React component');
    assert.match(main, /<output>\{\(\) => count\(\)\}<\/output>/, 'and renders as a function child');
    assert.doesNotMatch(main, /\{count\(\)\}/, 'a value read once by a React component never updates');
    for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
      const text = await readFile(join(root, doc), 'utf8');
      assert.match(text, /JSX goes through `what-react`/, `${doc} describes the compat authoring model`);
      assert.doesNotMatch(text, /This is the SPA template: Vite \+ `what-compiler`/, `${doc} does not claim the compiler`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

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

test('the islands CLAUDE.md describes the automatic runtime, not the compiler', async () => {
  const { cwd, root } = await scaffold('isl-claude', ['--template=islands']);
  try {
    const doc = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    assert.match(doc, /automatic runtime, NOT\s+`what-compiler`/);
    assert.match(doc, /<output>\{\(\) => count\(\)\}<\/output>/);
    assert.doesNotMatch(doc, /no compiler and no JSX/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('CLAUDE.md and AGENTS.md point at the skills and catalogue what-framework ships', async () => {
  const { cwd, root } = await scaffold('agent-docs');
  try {
    const whatPkg = JSON.parse(await readFile(resolve(repoRoot, 'packages/what/package.json'), 'utf8'));
    for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
      const text = await readFile(join(root, doc), 'utf8');
      const paths = [...text.matchAll(/node_modules\/what-framework\/([\w./-]+[\w])/g)].map((m) => m[1]);
      assert.deepEqual(
        [...new Set(paths)].sort(),
        ['UPGRADING.md', 'diagnostics.json', 'skills/what-diagnostics/SKILL.md', 'skills/what/SKILL.md'],
        `${doc} must name each shipped reference`,
      );
      for (const rel of paths) {
        await readFile(resolve(repoRoot, 'packages/what', rel), 'utf8');
        assert.ok(whatPkg.files.includes(rel.split('/')[0]), `${rel} must be in what-framework's published files`);
      }
      assert.match(text, /`what_connection_status`: one call orients you/, `${doc} teaches the one-call orientation`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
