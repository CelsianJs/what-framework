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
