import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');
const createWhatMeta = JSON.parse(await readFile(resolve(repoRoot, 'packages/create-what/package.json'), 'utf8'));
const expectedRange = `^${createWhatMeta.version}`;

function nextStepCd(stdout) {
  const line = stdout.split('\n').find((entry) => entry.trim().startsWith('cd '));
  assert.ok(line, `expected a printed cd next step:\n${stdout}`);
  return line.trim();
}

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

test('create-what prints shell-safe cd next steps for spaces and leading dashes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create what shell cd '));
  try {
    const spaced = spawnSync(process.execPath, [createWhat, 'space app', '--yes'], { cwd, encoding: 'utf8' });
    assert.equal(spaced.status, 0, spaced.stderr);
    const spacedCd = nextStepCd(spaced.stdout);
    assert.equal(
      await realpath(spawnSync('sh', ['-c', `${spacedCd} && pwd`], { cwd, encoding: 'utf8' }).stdout.trim()),
      await realpath(join(cwd, 'space app')),
    );

    const leadingDash = spawnSync(process.execPath, [createWhat], {
      cwd,
      input: '-dash-app\n\n\n',
      encoding: 'utf8',
    });
    assert.equal(leadingDash.status, 0, leadingDash.stderr);
    const dashCd = nextStepCd(leadingDash.stdout);
    assert.match(dashCd, /^cd \.\/-dash-app$/);
    assert.equal(
      await realpath(spawnSync('sh', ['-c', `${dashCd} && pwd`], { cwd, encoding: 'utf8' }).stdout.trim()),
      await realpath(join(cwd, '-dash-app')),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('create-what rejects unknown templates instead of falling back to SPA', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-bad-template-'));
  try {
    for (const { args, message } of [
      { args: ['demo-app', '--template=bogus', '--yes'], message: /unknown template "bogus"/ },
      { args: ['demo-app', '--template', 'bogus', '--yes'], message: /unknown template "bogus"/ },
      { args: ['demo-app', '--template=', '--yes'], message: /--template requires a value/ },
      { args: ['demo-app', '--template', '   ', '--yes'], message: /--template requires a value/ },
    ]) {
      const result = spawnSync(process.execPath, [createWhat, ...args], { cwd, encoding: 'utf8' });
      assert.notEqual(result.status, 0, 'invalid template must fail');
      assert.match(result.stderr, message);
      await assert.rejects(readFile(join(cwd, 'demo-app/package.json'), 'utf8'));
    }
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

    // package.json: what-isr dep + a `start` script for the Node server.
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['what-isr'], expectedRange);
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

test('create-what --template=islands scaffolds static pages with one island', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-islands-'));
  try {
    const result = spawnSync(process.execPath, [createWhat, 'isl-app', '--template=islands', '--yes'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /npm run build\s+# static HTML in dist\//);
    const root = join(cwd, 'isl-app');

    // JSX goes through the automatic runtime, so there is no compiler to install,
    // and the build is the scaffold's own prerender script.
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['what-framework'], expectedRange);
    assert.equal(pkg.devDependencies['what-compiler'], undefined);
    assert.equal(pkg.devDependencies['@babel/core'], undefined);
    assert.equal(pkg.devDependencies['what-devtools'], expectedRange);
    assert.equal(pkg.devDependencies['what-devtools-mcp'], expectedRange);
    assert.equal(pkg.scripts.build, 'node build.js');
    assert.equal(pkg.scripts.dev, 'vite');

    for (const f of [
      'vite.config.js', 'build.js', 'src/entry-server.js', 'src/entry-client.js',
      'src/components/Layout.jsx', 'src/pages/Home.jsx', 'src/pages/About.jsx',
      'src/islands/Counter.jsx', 'src/styles.css', 'public/favicon.svg',
    ]) {
      await readFile(join(root, f), 'utf8'); // throws if missing
    }
    // Pages are rendered by the server entry, so there is no index.html shell.
    await assert.rejects(readFile(join(root, 'index.html'), 'utf8'));

    const viteConfig = await readFile(join(root, 'vite.config.js'), 'utf8');
    assert.match(viteConfig, /jsx: 'automatic', jsxImportSource: 'what-framework'/);
    assert.doesNotMatch(viteConfig, /from 'what-compiler/);
    const tsconfig = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
    assert.equal(tsconfig.compilerOptions.jsx, 'react-jsx');
    assert.equal(tsconfig.compilerOptions.jsxImportSource, 'what-framework');
    assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /^\.ssr$/m);

    for (const f of ['vite.config.js', 'build.js', 'src/entry-server.js', 'src/entry-client.js']) {
      const check = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' });
      assert.equal(check.status, 0, `${f} failed --check: ${check.stderr}`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('choosing the islands template at the prompt scaffolds it and skips the SPA-only questions', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-islands-prompt-'));
  try {
    const result = spawnSync(process.execPath, [createWhat], { cwd, input: 'prompt-islands\n3\n', encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3\) Static site \+ islands/);
    assert.doesNotMatch(result.stdout, /React library support|CSS approach/);
    const pkg = JSON.parse(await readFile(join(cwd, 'prompt-islands/package.json'), 'utf8'));
    assert.equal(pkg.scripts.build, 'node build.js');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
