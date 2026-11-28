// Vite's `base` is the base of server actions: a page built with
// `base: '/app/'` renders a <Form> that posts to '/app/__what_action', with no
// setBase() call, because Vite gives what-server import.meta.env.BASE_URL, as
// it gives what-router. A relative base ('./') is none. Built for real with
// Vite and run.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = mkdtempSync(join(tmpdir(), 'what-actions-base-'));
symlinkSync(join(REPO, 'node_modules'), join(OUT, 'node_modules'), 'dir');
after(() => rmSync(OUT, { recursive: true, force: true }));

const ENTRY = join(OUT, 'entry.js');
writeFileSync(ENTRY, "export { Form } from 'what-server';\nexport { h, mount } from 'what-core';\n");

// The page built with `base`, the framework from source, as one module.
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
  it('is the base of the action endpoint a <Form> posts to, and a relative one is none', async () => {
    const env = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/app/page' });
    try {
      const app = document.getElementById('app');
      for (const [base, endpoint] of [['/app/', '/app/__what_action'], ['./', '/__what_action']]) {
        const page = await built(base, base === './' ? 'relative' : 'below');
        app.textContent = '';
        page.mount(page.h(page.Form, { action: 'subscribe', redirect: '/done' }), app);
        assert.equal(app.querySelector('form').getAttribute('action'), endpoint, base);
      }
    } finally {
      env.cleanup();
    }
  });
});
