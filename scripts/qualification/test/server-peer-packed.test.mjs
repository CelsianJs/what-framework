import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('a standalone packed what-server consumer installs required peers and renders SSR', () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'packages/server/package.json'), 'utf8'));
  assert.ok(manifest.peerDependencies['what-router']);
  assert.notEqual(manifest.peerDependenciesMeta?.['what-router']?.optional, true,
    'the Node entry eagerly imports the router; npm must install it for standalone consumers');

  const work = mkdtempSync(join(tmpdir(), 'what-server-peer-'));
  try {
    const tarDir = join(work, 'tarballs');
    const app = join(work, 'app');
    mkdirSync(tarDir);
    mkdirSync(app);
    const packs = {};
    for (const name of ['core', 'router', 'server']) {
      const output = execFileSync('npm', [
        'pack', resolve(repo, 'packages', name), '--pack-destination', tarDir, '--ignore-scripts', '--silent',
      ], { encoding: 'utf8', timeout: 30000 });
      packs[`what-${name}`] = `file:${join(tarDir, output.trim().split('\n').pop())}`;
    }
    writeFileSync(join(app, 'package.json'), JSON.stringify({
      private: true, type: 'module',
      dependencies: { 'what-server': packs['what-server'] },
      overrides: { 'what-core': packs['what-core'], 'what-router': packs['what-router'] },
    }));
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
      cwd: app, encoding: 'utf8', timeout: 30000,
    });
    for (const name of ['what-core', 'what-router']) {
      const installed = JSON.parse(readFileSync(join(app, 'node_modules', name, 'package.json'), 'utf8'));
      assert.equal(installed.version, manifest.version, `${name} must be installed from this tree`);
    }
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { h } from 'what-core';
      import { renderToString } from 'what-server';
      assert.equal(typeof document, 'undefined');
      assert.equal(renderToString(h('main', {}, h('h1', {}, 'Standalone SSR'))), '<main><h1>Standalone SSR</h1></main>');
      console.log('packed standalone SSR verified');
    `], { cwd: app, encoding: 'utf8', timeout: 15000 });
    assert.match(result, /packed standalone SSR verified/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
