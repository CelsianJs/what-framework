import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { transformImports, fileToRoute } from '../src/cli.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const cli = resolve(repoRoot, 'packages/cli/src/cli.js');
const cliMeta = JSON.parse(readFileSync(resolve(repoRoot, 'packages/cli/package.json'), 'utf8'));
const expectedRange = `^${cliMeta.version}`;

test('what build loads default config without TDZ crash', () => {
  const cwd = mkdtempDir('what-cli-build-');
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/main.js'), 'console.log("hello what");\n');
    const result = spawnSync(process.execPath, [cli, 'build'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /what build/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what init scaffolds current release dependency range', () => {
  const cwd = mkdtempDir('what-cli-init-');
  try {
    const result = spawnSync(process.execPath, [cli, 'init', 'demo-app'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const pkg = JSON.parse(readFileSync(join(cwd, 'demo-app/package.json'), 'utf8'));
    assert.equal(pkg.dependencies['what-framework'], expectedRange);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// Regression for the audit CRITICAL: init used to emit only package.json +
// what.config.js with scripts calling a `what` bin that nothing provides.
// It now delegates to create-what, so the scaffold must be the real app —
// runnable files and scripts that resolve to installed binaries (vite).
test('what init produces the full create-what scaffold with runnable scripts', () => {
  const cwd = mkdtempDir('what-cli-init-full-');
  try {
    const result = spawnSync(process.execPath, [cli, 'init', 'demo-app'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /npm install/, 'prints next steps');
    assert.match(result.stdout, /npm run dev/, 'prints next steps');

    const root = join(cwd, 'demo-app');
    for (const f of ['index.html', 'vite.config.js', 'eslint.config.js', 'src/main.jsx', 'src/styles.css']) {
      readFileSync(join(root, f), 'utf8'); // throws if missing
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.dev, 'vite', 'dev script uses vite, not a phantom `what` bin');
    for (const script of Object.values(pkg.scripts)) {
      assert.doesNotMatch(script, /^what(\s|$)/, `script "${script}" must not call the unshipped \`what\` bin`);
    }
    assert.ok(pkg.devDependencies.vite, 'vite is a devDependency so the scripts resolve');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what init forwards flags to create-what (--fullstack)', () => {
  const cwd = mkdtempDir('what-cli-init-fs-');
  try {
    const result = spawnSync(process.execPath, [cli, 'init', 'fs-app', '--fullstack'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const root = join(cwd, 'fs-app');
    readFileSync(join(root, 'server.js'), 'utf8');
    readFileSync(join(root, 'src/routes.js'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.start, 'node server.js');
    assert.equal(pkg.dependencies['what-isr'], expectedRange);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what init refuses to overwrite an existing directory', () => {
  const cwd = mkdtempDir('what-cli-init-exists-');
  try {
    mkdirSync(join(cwd, 'demo-app'));
    writeFileSync(join(cwd, 'demo-app/keep.txt'), 'precious\n');
    const result = spawnSync(process.execPath, [cli, 'init', 'demo-app'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /already exists/);
    assert.equal(readFileSync(join(cwd, 'demo-app/keep.txt'), 'utf8'), 'precious\n');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what start runs the project server.js (Node adapter)', () => {
  const cwd = mkdtempDir('what-cli-start-');
  try {
    writeFileSync(join(cwd, 'server.js'), 'console.log("SERVER UP"); process.exit(0);\n');
    const result = spawnSync(process.execPath, [cli, 'start'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /SERVER UP/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what start without a server.js fails with guidance', () => {
  const cwd = mkdtempDir('what-cli-start-missing-');
  try {
    const result = spawnSync(process.execPath, [cli, 'start'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /server\.js/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// Regression: the transform only knew the pre-0.11 package name ('what'), so an
// app importing the published name emitted the bare specifier verbatim into
// dist/, a module no browser can resolve.
test('transformImports rewrites the published package name and its subpaths', () => {
  const code = [
    "import { signal } from 'what-framework';",
    "import { Router } from 'what-framework/router';",
    "import { island } from 'what-framework/server';",
    "import { jsx } from 'what-framework/jsx-runtime';",
    "import { mount } from 'what';",
    "const lazy = await import('what-framework/router');",
  ].join('\n');

  const out = transformImports(code);
  assert.doesNotMatch(out, /'what(-framework)?(\/[\w-]+)?'/, 'no bare specifier may survive');
  assert.match(out, /from '\/@what\/core\.js'/);
  assert.match(out, /from '\/@what\/router\.js'/);
  assert.match(out, /from '\/@what\/server\.js'/);
  assert.match(out, /from '\/@what\/jsx-runtime\.js'/);
  assert.match(out, /import\('\/@what\/router\.js'\)/);
});

test('fileToRoute maps index files to their directory route', () => {
  assert.equal(fileToRoute('index.js'), '/');
  assert.equal(fileToRoute('about.js'), '/about');
  assert.equal(fileToRoute('blog/index.js'), '/blog');
  assert.equal(fileToRoute('blog/[id].js'), '/blog/:id');
});

test('what build emits a runnable artifact (runtime present, no bare imports)', () => {
  const cwd = mkdtempDir('what-cli-artifact-');
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/main.js'), "import { signal } from 'what-framework';\nexport const n = signal(0);\n");
    const result = spawnSync(process.execPath, [cli, 'build'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const manifest = JSON.parse(readFileSync(join(cwd, 'dist/manifest.json'), 'utf8'));
    const built = readFileSync(join(cwd, 'dist', manifest['main.js']), 'utf8');
    assert.match(built, /from '\/@what\/core\.js'/);

    // Runtime files keep their stable /@what/ names so app imports resolve.
    for (const f of ['dist/@what/core.js', 'dist/@what/core/index.js', 'dist/@what/router/index.js']) {
      assert.ok(existsSync(join(cwd, f)), `${f} must be emitted`);
    }
    // Cross-package runtime imports must be relative, not bare.
    const router = readFileSync(join(cwd, 'dist/@what/router/index.js'), 'utf8');
    assert.match(router, /from '\.\.\/core\/index\.js'/);
    // Minification must not eat URLs inside string literals.
    const dom = readFileSync(join(cwd, 'dist/@what/core/dom.js'), 'utf8');
    assert.match(dom, /http:\/\/www\.w3\.org\/2000\/svg/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// Regression: the runtime used to be resolved as `../../what/src` relative to
// this file. Inside the monorepo that works; from node_modules/what-framework-cli
// it points at a package that does not exist, and the build silently exited 0
// with zero framework code in dist/.
test('what build fails loudly when the runtime cannot be resolved', () => {
  const root = mkdtempDir('what-cli-nopkg-');
  try {
    const cliDir = join(root, 'node_modules/what-framework-cli/src');
    mkdirSync(cliDir, { recursive: true });
    copyFileSync(cli, join(cliDir, 'cli.js'));
    copyFileSync(resolve(repoRoot, 'packages/cli/package.json'), join(root, 'node_modules/what-framework-cli/package.json'));

    const cwd = join(root, 'app');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/main.js'), "import { signal } from 'what-framework';\n");

    const result = spawnSync(process.execPath, [join(cliDir, 'cli.js'), 'build'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'a build without a runtime must not exit 0');
    assert.match(result.stdout + result.stderr, /what-core/);
    assert.match(result.stdout + result.stderr, /npm install what-framework/);
    assert.ok(!existsSync(join(cwd, 'dist/@what')), 'no half-built runtime directory');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('what build in an empty directory fails with guidance', () => {
  const cwd = mkdtempDir('what-cli-empty-');
  try {
    const result = spawnSync(process.execPath, [cli, 'build'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /no app found/);
    assert.doesNotMatch(result.stdout, /Files:\s+0/, 'must not report a successful empty build');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what generate pre-renders pages to HTML', () => {
  const cwd = mkdtempDir('what-cli-generate-');
  try {
    mkdirSync(join(cwd, 'src/pages/blog'), { recursive: true });
    writeFileSync(
      join(cwd, 'src/pages/index.js'),
      "export default function Home() {\n  return { tag: 'h1', props: {}, children: ['Hello SSG'] };\n}\n"
    );
    writeFileSync(
      join(cwd, 'src/pages/blog/[id].js'),
      "export default function Post() {\n  return { tag: 'p', props: {}, children: ['Post'] };\n}\n"
    );

    const result = spawnSync(process.execPath, [cli, 'generate'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const html = readFileSync(join(cwd, 'dist/index.html'), 'utf8');
    assert.match(html, /<h1>Hello SSG<\/h1>/, 'the page must actually be rendered, not just logged');
    assert.match(result.stdout, /Pre-rendered:\s+\//);
    assert.match(result.stdout, /Skipped:\s+\/blog\/:id/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what generate without a pages directory fails with guidance', () => {
  const cwd = mkdtempDir('what-cli-generate-empty-');
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/main.js'), 'export const n = 1;\n');
    const result = spawnSync(process.execPath, [cli, 'generate'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /no pages directory/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('what --version prints the version and unknown commands fail', () => {
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), cliMeta.version);

  const help = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: what <command>/);
  assert.notEqual(help.stdout, version.stdout, '--version must not just print help');

  const unknown = spawnSync(process.execPath, [cli, 'bogus-command'], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown command: bogus-command/);
});

function mkdtempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}
