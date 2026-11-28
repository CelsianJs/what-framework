/**
 * Regression: `vite dev` must NOT crash when the optional `what-devtools` peer
 * is not installed.
 *
 * The injected bootstrap module does `import { installDevTools } from 'what-devtools'`.
 * If the consumer hasn't installed that peer, Vite's dev transform cannot resolve
 * the bare import and the dev server dies with a transform error. The plugin now
 * probes for `what-devtools` up front (resolve from the project root) and, when
 * it's missing, degrades gracefully: it injects nothing and logs one clear,
 * non-fatal notice instead of crashing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('vite-plugin degrades gracefully when what-devtools is not installed', () => {
  it('injects nothing and does not throw when the peer cannot be resolved', async () => {
    const { default: whatDevToolsMCP } = await import('../src/vite-plugin.js');
    const plugin = whatDevToolsMCP();

    // A project root OUTSIDE the repo, so `require` resolution cannot walk up
    // into the workspace node_modules and accidentally find what-devtools.
    const isolatedRoot = mkdtempSync(join(tmpdir(), 'what-no-devtools-'));
    const infos = [];
    const origInfo = console.info;
    console.info = (...a) => infos.push(a.map(String).join(' '));
    let threw = null;
    try {
      plugin.configResolved({ command: 'serve', root: isolatedRoot });
    } catch (e) {
      threw = e;
    } finally {
      console.info = origInfo;
      rmSync(isolatedRoot, { recursive: true, force: true });
    }

    assert.equal(threw, null, 'configResolved must not throw when the peer is missing');
    assert.ok(
      infos.some((m) => m.includes('what-devtools') && m.includes('not installed')),
      'logs exactly one clear notice that what-devtools is not installed',
    );

    // No injection anywhere: the dev server would boot without the bootstrap.
    assert.equal(plugin.transformIndexHtml(), undefined, 'no bootstrap <script> injected');
    assert.equal(plugin.resolveId('virtual:what-devtools-mcp/bootstrap'), null, 'does not own the virtual id');
    assert.equal(plugin.load('\0virtual:what-devtools-mcp/bootstrap'), null, 'emits no bootstrap source');
  });

  it('still injects when what-devtools IS resolvable (peer present, serve)', async () => {
    const { default: whatDevToolsMCP } = await import('../src/vite-plugin.js');
    const plugin = whatDevToolsMCP();

    // HERE is inside the repo, so resolution walks up to the workspace
    // node_modules where what-devtools is symlinked — the peer is present.
    plugin.configResolved({ command: 'serve', root: HERE });

    const html = plugin.transformIndexHtml();
    assert.ok(Array.isArray(html) && html.length === 1, 'injects the bootstrap script when the peer is present');
    const resolved = plugin.resolveId('virtual:what-devtools-mcp/bootstrap');
    assert.equal(resolved, '\0virtual:what-devtools-mcp/bootstrap');
    const code = plugin.load(resolved);
    assert.match(code, /connectDevToolsMCP\(/);
  });
});

describe('vite-plugin finds what-devtools the way Vite resolves the bootstrap import', () => {
  it('ignores a what-devtools reachable only through NODE_PATH (pnpm bin shims set it to the hidden store)', async () => {
    const { default: whatDevToolsMCP } = await import('../src/vite-plugin.js');
    const plugin = whatDevToolsMCP();
    // A pnpm-like layout: the app has no what-devtools, the hidden store does.
    const base = mkdtempSync(join(tmpdir(), 'what-node-path-'));
    const store = join(base, 'store', 'node_modules', 'what-devtools');
    const app = join(base, 'app');
    mkdirSync(store, { recursive: true });
    mkdirSync(app, { recursive: true });
    writeFileSync(join(store, 'package.json'), JSON.stringify({ name: 'what-devtools', main: 'index.js' }));
    writeFileSync(join(store, 'index.js'), 'module.exports = {};');
    const savedNodePath = process.env.NODE_PATH;
    const origInfo = console.info;
    console.info = () => {};
    try {
      process.env.NODE_PATH = join(base, 'store', 'node_modules');
      // Node's CommonJS resolution reads NODE_PATH when it initializes paths.
      createRequire(import.meta.url)('module')._initPaths();
      assert.ok(createRequire(join(app, 'noop.js')).resolve('what-devtools'), 'require.resolve finds it through NODE_PATH');
      plugin.configResolved({ command: 'serve', root: app });
      assert.equal(plugin.transformIndexHtml(), undefined, 'no bootstrap: Vite could not resolve its import');
      assert.equal(plugin.resolveId('virtual:what-devtools-mcp/bootstrap'), null);
    } finally {
      console.info = origInfo;
      if (savedNodePath === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = savedNodePath;
      createRequire(import.meta.url)('module')._initPaths();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
