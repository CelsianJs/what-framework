import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

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

function mkdtempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}
