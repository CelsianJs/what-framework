import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');
const createWhatMeta = JSON.parse(await readFile(resolve(repoRoot, 'packages/create-what/package.json'), 'utf8'));
const expectedRange = `^${createWhatMeta.version}`;

test('create-what --help prints usage without scaffolding', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-help-'));
  try {
    const result = spawnSync(process.execPath, [createWhat, '--help'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.doesNotMatch(result.stdout, /Created my-what-app/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('create-what scaffolds dependencies aligned to package version', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-default-'));
  try {
    const result = spawnSync(process.execPath, [createWhat, 'demo-app', '--yes'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const pkg = JSON.parse(await readFile(join(cwd, 'demo-app/package.json'), 'utf8'));
    assert.equal(pkg.dependencies['what-framework'], expectedRange);
    assert.equal(pkg.devDependencies['what-compiler'], expectedRange);
    assert.equal(pkg.devDependencies['what-devtools-mcp'], expectedRange);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('create-what honors absolute target paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-abs-cwd-'));
  const targetRoot = await mkdtemp(join(tmpdir(), 'create-what-abs-target-'));
  const target = join(targetRoot, 'abs-app');
  try {
    const result = spawnSync(process.execPath, [createWhat, target, '--yes'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'abs-app');
    assert.equal(pkg.dependencies['what-framework'], expectedRange);
    await assert.rejects(readFile(join(cwd, target.replace(/^\/+/, ''), 'package.json'), 'utf8'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test('create-what --fullstack scaffolds a parseable SSR tree', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-fullstack-'));
  try {
    const result = spawnSync(process.execPath, [createWhat, 'fs-app', '--fullstack', '--yes'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const root = join(cwd, 'fs-app');

    // package.json: what-cache dep + a `start` script for the Node server.
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['what-cache'], expectedRange);
    assert.equal(pkg.scripts.start, 'node server.js');

    // The full-stack tree exists.
    for (const f of [
      'server.js', 'what.config.js', 'src/routes.js', 'src/db.js',
      'src/actions/posts.js', 'src/pages/home.js', 'src/pages/post.js', 'src/pages/new.js',
    ]) {
      await readFile(join(root, f), 'utf8'); // throws if missing
    }

    // Pages export the file-route contract (page/loader/default) and the
    // dynamic page exports getStaticPaths.
    const home = await readFile(join(root, 'src/pages/home.js'), 'utf8');
    assert.match(home, /export const page =/);
    assert.match(home, /export const loader =/);
    assert.match(home, /export default function/);
    const post = await readFile(join(root, 'src/pages/post.js'), 'utf8');
    assert.match(post, /export async function getStaticPaths/);

    // The generated tree is syntactically valid ES modules — node parses it
    // with --check (no execution, so no dependency resolution needed).
    for (const f of ['src/db.js', 'src/pages/home.js', 'src/pages/post.js', 'src/pages/new.js', 'server.js']) {
      const check = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' });
      assert.equal(check.status, 0, `${f} failed --check: ${check.stderr}`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

