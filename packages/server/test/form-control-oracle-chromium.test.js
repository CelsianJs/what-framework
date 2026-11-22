// The form-control oracle (fixtures/form-oracle.js) in Chromium: live
// checkedness, option selectedness, a single select's own choice of option and
// FormData are the browser's, where JSDOM's can differ. The server markup is
// rendered here, in Node, and parsed in the page next to the equivalent static
// HTML; the client paths run in the page with the development runtime. The
// part run is every shape with a checkedness or a selection (checkbox, radio
// group, single and multiple selects) plus every tenth other shape, on every
// client path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { installDOM } from '../../../test-utils/dom.js';
import { shapes, jsxModule, hComponent, isDynamic } from './fixtures/form-oracle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

const browserAvailable = existsSync(chromium.executablePath());
if (!browserAvailable && process.env.WHAT_REQUIRE_BROWSER_TESTS === '1') {
  throw new Error('WHAT_REQUIRE_BROWSER_TESTS=1 but Chromium is missing; run npx playwright install --with-deps chromium.');
}

const SHAPES = shapes().filter((s) => s.control !== 'text' && s.control !== 'textarea' || s.id % 10 === 0);
const AUTHORINGS = ['h', 'compiled', 'spread'];
const SOURCES = ['h:hydratable', 'h:stream', 'compiled:hydratable', 'spread:hydratable'];

// Every server render the page parses: `${id}|${authoring}|${renderer}`.
async function serverMarkup() {
  installDOM();
  const { h, signal } = await import('../../core/src/index.js');
  const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');
  const stream = async (view) => {
    let html = '';
    for await (const chunk of renderToStream(view)) html += chunk;
    return html;
  };
  const renderers = { string: renderToString, hydratable: renderToHydratableString, stream };
  const server = await loadCompiled(jsxModule(SHAPES), { pluginOptions: { generate: 'ssr' } });
  const markup = {};
  for (const shape of SHAPES) {
    for (const authoring of AUTHORINGS) {
      const Component = authoring === 'h' ? hComponent(h, shape) : server[`${authoring === 'spread' ? 'S' : 'C'}${shape.id}`];
      for (const [name, render] of Object.entries(renderers)) {
        markup[`${shape.id}|${authoring}|${name}`] = await render(h(Component, { v: isDynamic(shape) ? signal(shape.initial) : undefined }));
      }
    }
  }
  return markup;
}

// The page's bundle: the fixture, the runtime and both compiled client builds.
async function pageBundle(dir) {
  const rewrite = (code) => code.replace(/(['"])what-framework(\/render)?\1/g, (_, q, sub) =>
    JSON.stringify(path.join(root, 'packages/core/src', sub ? 'render.js' : 'index.js')));
  const source = jsxModule(SHAPES);
  writeFileSync(path.join(dir, 'client.mjs'), rewrite(compileJSX(source)));
  writeFileSync(path.join(dir, 'hydratable.mjs'), rewrite(compileJSX(source, { pluginOptions: { hydratable: true } })));
  writeFileSync(path.join(dir, 'entry.mjs'), `
    import * as core from ${JSON.stringify(path.join(root, 'packages/core/src/index.js'))};
    import { _resetForm } from ${JSON.stringify(path.join(root, 'packages/core/src/dom.js'))};
    import * as oracle from ${JSON.stringify(path.join(here, 'fixtures/form-oracle.js'))};
    import * as client from './client.mjs';
    import * as hydratable from './hydratable.mjs';
    const env = { h: core.h, mount: core.mount, hydrate: core.hydrate, flushSync: core.flushSync, signal: core.signal, resetForm: _resetForm, document };
    const byId = new Map(oracle.shapes().map((s) => [s.id, s]));
    const component = (shape, authoring, build) => authoring === 'h' ? oracle.hComponent(core.h, shape) : build[(authoring === 'spread' ? 'S' : 'C') + shape.id];
    export async function run(ids, markup, authorings, sources) {
      const findings = [];
      let server = 0;
      let clients = 0;
      for (const id of ids) {
        const shape = byId.get(id);
        for (const authoring of authorings) {
          for (const renderer of ['string', 'hydratable', 'stream']) {
            server++;
            const found = oracle.checkServerHtml(env, shape, markup[id + '|' + authoring + '|' + renderer]);
            if (found) findings.push({ shape, authoring, renderer, ...found });
          }
          clients++;
          const mounted = await oracle.runClient(env, shape, component(shape, authoring, client));
          if (mounted) findings.push({ shape, path: authoring + ' mount', ...mounted });
          for (const source of sources) {
            clients++;
            const [from, renderer] = source.split(':');
            const found = await oracle.runClient(env, shape, component(shape, authoring, hydratable), markup[id + '|' + from + '|' + renderer]);
            if (found) findings.push({ shape, path: authoring + ' hydrating ' + source, ...found });
          }
        }
      }
      return { findings, server, clients };
    }
  `);
  const bundle = await build({ entryPoints: [path.join(dir, 'entry.mjs')], bundle: true, format: 'iife', globalName: 'Oracle', write: false,
    define: { __WHAT_DEV__: 'true' }, logLevel: 'silent' });
  return bundle.outputFiles[0].text;
}

describe('form-control oracle in Chromium', { skip: !browserAvailable }, () => {
  it('checkedness, selection and FormData follow the static HTML and the reference model', async () => {
    const markup = await serverMarkup();
    const dir = mkdtempSync(path.join(tmpdir(), 'what-form-oracle-'));
    const browser = await chromium.launch();
    try {
      const script = await pageBundle(dir);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent('<!doctype html><html><body></body></html>');
      await page.addScriptTag({ content: script });
      const result = await page.evaluate(([ids, m, a, s]) => globalThis.Oracle.run(ids, m, a, s),
        [SHAPES.map((s) => s.id), markup, AUTHORINGS, SOURCES]);
      console.log(`form oracle (Chromium): ${SHAPES.length} shapes, ${result.server} server cases, ${result.clients} client cases, ${result.findings.length} findings`);
      assert.deepEqual(errors, []);
      assert.equal(result.findings.length, 0, result.findings.slice(0, 12).map((f) => JSON.stringify(f)).join('\n'));
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
