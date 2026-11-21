/**
 * Regression: the devtools bootstrap must find what-core when the app cannot.
 *
 * The bootstrap imports `what-core/internal`. A scaffolded SPA depends on
 * what-framework, not what-core, so under pnpm (which installs what-core next
 * to what-framework and links only the app's own dependencies into its
 * node_modules) resolving that import from the app root failed and the dev
 * server answered the bootstrap with a 500. what-devtools-mcp depends on
 * what-core, so the plugin falls back to resolving it from its own location.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import whatDevToolsMCP from '../src/vite-plugin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const BOOTSTRAP = '\0virtual:what-devtools-mcp/bootstrap';

describe('the devtools bootstrap resolves what-core from what-devtools-mcp when the app cannot', () => {
  let root;
  let server;

  before(async () => {
    // An app outside the repo with pnpm's top level: its own dependencies
    // only, no what-core.
    root = mkdtempSync(join(tmpdir(), 'what-devtools-pnpm-'));
    mkdirSync(join(root, 'node_modules'));
    for (const [name, dir] of [['what-devtools', 'packages/devtools'], ['what-devtools-mcp', 'packages/devtools-mcp']]) {
      symlinkSync(join(REPO, dir), join(root, 'node_modules', name), 'dir');
    }
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><body></body></html>');
    assert.equal(existsSync(join(root, 'node_modules', 'what-core')), false);

    const { NODE_ENV } = process.env;
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      cacheDir: join(root, '.vite'),
      plugins: [whatDevToolsMCP()],
      server: { middlewareMode: true, ws: false },
    });
    // createServer sets NODE_ENV for the whole test process; put it back.
    if (NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = NODE_ENV;
  });

  after(async () => {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves what-core/internal to the copy what-devtools-mcp depends on', async () => {
    const resolved = await server.environments.client.pluginContainer.resolveId('what-core/internal', BOOTSTRAP);
    assert.equal(resolved?.id, join(REPO, 'packages/core/src/entries/internal.js'));
  });

  it('serves the bootstrap with every import resolved', async () => {
    const result = await server.transformRequest('virtual:what-devtools-mcp/bootstrap');
    assert.ok(result, 'the bootstrap transforms');
    assert.match(result.code, /packages\/core\/src\/entries\/internal\.js/, 'what-core/internal points at a real file');
  });

  it('leaves what-core alone for every other importer', async () => {
    const plugin = whatDevToolsMCP();
    plugin.configResolved({ command: 'serve', root: HERE });
    assert.equal(plugin.resolveId('what-core/internal', join(root, 'src', 'main.js')), null);
  });
});
