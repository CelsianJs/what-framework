// A build stops with ERR_COMPILER_RUNTIME_MISMATCH, naming both versions, when
// what-compiler meets a what-framework or what-core of another release: one
// the app's compiled modules would import (what-compiler/vite from the
// project root, the Babel plugin from the file it compiles). The compiler loads
// beside any what-core, and by require(), so nothing fails before the check.
// npm refuses such an install (the peer ranges, compiler-runtime-lockstep.test.js);
// this is what an install that skipped peer checks meets.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import whatBabelPlugin from '../src/babel-plugin.js';
import whatVitePlugin from '../src/vite-plugin.js';
import { runtimeMismatch, satisfiesRelease } from '../src/release.js';
import fs from 'node:fs';

const compilerDir = fileURLToPath(new URL('..', import.meta.url));
const own = JSON.parse(readFileSync(join(compilerDir, 'package.json'), 'utf8')).version;
const [major, minor] = own.split('.').map(Number);
const older = `${major}.${minor - 1}.0`;
const newer = `${major}.${minor + 1}.0`;

const root = mkdtempSync(join(tmpdir(), 'what-release-'));
function app(name, versions) {
  const dir = join(root, name);
  for (const [pkg, version] of Object.entries(versions)) {
    mkdirSync(join(dir, 'node_modules', pkg), { recursive: true });
    writeFileSync(join(dir, 'node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg, version }));
  }
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
  return dir;
}

after(() => rmSync(root, { recursive: true, force: true }));

describe('satisfiesRelease: the caret each release declares on its siblings', () => {
  it('admits patches at or after the base and nothing else below 1.0', () => {
    assert.equal(satisfiesRelease('0.15.0', '0.15.0'), true);
    assert.equal(satisfiesRelease('0.15.3', '0.15.1'), true);
    assert.equal(satisfiesRelease('0.15.0-rc.1', '0.15.0'), true);
    assert.equal(satisfiesRelease('0.15.0', '0.15.1'), false);
    assert.equal(satisfiesRelease('0.14.9', '0.15.0'), false);
    assert.equal(satisfiesRelease('0.16.0', '0.15.0'), false);
    assert.equal(satisfiesRelease('1.4.0', '1.2.0'), true);
    assert.equal(satisfiesRelease('2.0.0', '1.2.0'), false);
    assert.equal(satisfiesRelease('workspace', '0.15.0'), false);
  });
});

describe('runtimeMismatch', () => {
  it('names both versions, the package.json it read and the UPGRADING step, in one line', () => {
    const dir = app('older-framework', { 'what-framework': older, 'what-core': own });
    const err = runtimeMismatch(join(dir, 'src', 'deep'), fs);
    assert.equal(err.code, 'ERR_COMPILER_RUNTIME_MISMATCH');
    assert.deepEqual(err.runtime, { name: 'what-framework', version: older, file: `${dir}/node_modules/what-framework/package.json` });
    assert.equal(err.message.split('\n').length, 1);
    assert.match(err.message, new RegExp(`^\\[what-compiler\\] ERR_COMPILER_RUNTIME_MISMATCH: what-compiler ${own.replaceAll('.', '\\.')} cannot build for what-framework ${older.replaceAll('.', '\\.')} `));
    assert.match(err.message, new RegExp(`npm install what-framework@${own.replaceAll('.', '\\.')} what-compiler@${own.replaceAll('.', '\\.')}`), 'the fix upgrades to the later release');
    assert.match(err.message, /step 1 of "Before you start" in UPGRADING\.md/);
  });

  it('checks what-core too, and suggests the later release when the runtime is newer', () => {
    const dir = app('newer-core', { 'what-framework': own, 'what-core': newer });
    const err = runtimeMismatch(join(dir, 'src'), fs);
    assert.equal(err.runtime.name, 'what-core');
    assert.match(err.message, new RegExp(`npm install what-framework@${newer.replaceAll('.', '\\.')} what-compiler@${newer.replaceAll('.', '\\.')}`));
  });

  it('is null for the same release, for nothing installed, and without fs', () => {
    assert.equal(runtimeMismatch(join(app('same', { 'what-framework': own, 'what-core': own }), 'src'), fs), null);
    assert.equal(runtimeMismatch(join(root, 'nowhere', 'src'), fs), null);
    assert.equal(runtimeMismatch(join(app('no-fs', { 'what-framework': older }), 'src'), null), null);
  });
});

describe('the entry points that build', () => {
  it('the Babel plugin stops before compiling a file whose runtime is another release', { skip: typeof process.getBuiltinModule !== 'function' && 'this Node has no process.getBuiltinModule' }, () => { // node-floor: feature-detected
    const dir = app('babel', { 'what-framework': older });
    const compile = (filename) => transformSync('export const A = () => <p>a</p>;', {
      filename, configFile: false, babelrc: false, plugins: [[whatBabelPlugin, {}]], parserOpts: { plugins: ['jsx'] },
    });
    assert.throws(() => compile(join(dir, 'src', 'A.jsx')), (err) => err.code === 'ERR_COMPILER_RUNTIME_MISMATCH' && err.message.includes(`what-framework ${older}`));
    assert.match(compile(join(app('babel-same', { 'what-framework': own }), 'src', 'A.jsx')).code, /_\$template/);
    assert.match(compile(undefined).code, /_\$template/, 'a snippet with no file has nothing to check');
  });

  it('what-compiler/vite stops when the config resolves, before any transform', () => {
    const plugin = whatVitePlugin();
    assert.throws(() => plugin.configResolved({ root: app('vite', { 'what-framework': older }), command: 'build' }), { code: 'ERR_COMPILER_RUNTIME_MISMATCH' });
    assert.doesNotThrow(() => whatVitePlugin().configResolved({ root: app('vite-same', { 'what-framework': own }), command: 'build' }));
  });

  // An install like `npm i -D what-compiler@latest --legacy-peer-deps` on an
  // app of 0.14, whose what-core has no ./internal export.
  function besideOlderCore(name) {
    const dir = app(name, { 'what-core': older });
    writeFileSync(join(dir, 'node_modules', 'what-core', 'package.json'), JSON.stringify({ name: 'what-core', version: older, type: 'module', exports: { '.': './index.js' } }));
    writeFileSync(join(dir, 'node_modules', 'what-core', 'index.js'), 'export {};\n');
    const copy = join(dir, 'node_modules', 'what-compiler');
    cpSync(join(compilerDir, 'src'), join(copy, 'src'), { recursive: true });
    cpSync(join(compilerDir, 'package.json'), join(copy, 'package.json'));
    mkdirSync(join(dir, 'node_modules', '@babel'), { recursive: true });
    symlinkSync(join(createRequire(import.meta.url).resolve('@babel/core/package.json'), '..'), join(dir, 'node_modules', '@babel', 'core'), 'dir');
    return dir;
  }
  const run = (cwd, script, ...flags) => spawnSync(process.execPath, [...flags, '-e', script], { cwd, encoding: 'utf8' });
  const named = new RegExp(`ERR_COMPILER_RUNTIME_MISMATCH: what-compiler ${own.replaceAll('.', '\\.')} cannot build for what-core ${older.replaceAll('.', '\\.')}`);

  it('load beside a what-core of another release, and name it', () => {
    const dir = besideOlderCore('own-core');
    const vite = run(dir, "const { default: what } = await import('what-compiler/vite'); what().configResolved({ root: process.cwd(), command: 'build' });", '--input-type=module');
    assert.match(vite.stderr, named);
    const babel = run(dir, "const { default: plugin } = await import('what-compiler/babel'); const { transformSync } = (await import('@babel/core')).default; transformSync('<p/>', { filename: process.cwd() + '/src/A.jsx', configFile: false, babelrc: false, plugins: [plugin], parserOpts: { plugins: ['jsx'] } });", '--input-type=module');
    if (typeof process.getBuiltinModule === 'function') assert.match(babel.stderr, named);
    else assert.equal(babel.status, 0, babel.stderr);
  });

  // A Vite config in a project without "type": "module" (or vite.config.cjs)
  // loads the plugin by require(), which a top-level await anywhere in its
  // graph refuses (ERR_REQUIRE_ASYNC_MODULE).
  it('what-compiler/vite and the root entry load by require()', { skip: !process.features.require_module && 'this Node has no require(esm)' }, () => {
    for (const entry of ['vite', 'babel', 'index']) {
      const file = { vite: 'vite-plugin.js', babel: 'babel-plugin.js', index: 'index.js' }[entry];
      const loaded = run(compilerDir, `const m = require(${JSON.stringify(join(compilerDir, 'src', file))}); if (typeof (m.default ?? m.vitePlugin) !== 'function') throw new Error('no plugin');`, '--input-type=commonjs');
      assert.equal(loaded.status, 0, loaded.stderr);
    }
  });
});
