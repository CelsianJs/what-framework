// Vite's `base` is the router's base: an app built with `base: '/app/'`
// routes below /app with no setBase() call, because Vite gives the router
// import.meta.env.BASE_URL. A relative base ('./') says nothing about where
// the app's pages are, so it routes from the root. Built for real with Vite
// and run, as base-path.test.js runs the router with setBase().

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = mkdtempSync(join(tmpdir(), 'what-router-base-'));
symlinkSync(join(REPO, 'node_modules'), join(OUT, 'node_modules'), 'dir');
after(() => rmSync(OUT, { recursive: true, force: true }));

const ENTRY = join(OUT, 'entry.js');
writeFileSync(ENTRY, "export { route, Link } from 'what-router';\nexport { h, mount } from 'what-core';\n");

// The app built with `base`, the framework from source (the `import`
// condition, not the dist a production build resolves), as one module.
async function built(base, name) {
  const { build } = await import('vite');
  const output = await build({
    configFile: false,
    root: OUT,
    base,
    logLevel: 'silent',
    mode: 'production',
    resolve: { conditions: ['browser', 'import', 'default'] },
    build: { write: false, minify: false, lib: { entry: ENTRY, formats: ['es'], fileName: name } },
  });
  const chunk = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).find((o) => o.type === 'chunk');
  const file = join(OUT, `${name}.mjs`);
  writeFileSync(file, chunk.code);
  return import(pathToFileURL(file).href);
}

describe('Vite\'s base', () => {
  it('is the router\'s base, and a relative one is none', async () => {
    const env = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/app/about' });
    try {
      const below = await built('/app/', 'below');
      assert.equal(below.route.path, '/about');
      const app = document.getElementById('app');
      below.mount(below.h(below.Link, { href: '/users' }, 'users'), app);
      assert.equal(app.querySelector('a').getAttribute('href'), '/app/users');
      const relative = await built('./', 'relative');
      assert.equal(relative.route.path, '/app/about');
    } finally {
      env.cleanup();
    }
  });
});
