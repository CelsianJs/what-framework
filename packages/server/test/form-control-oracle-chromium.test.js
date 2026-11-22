// The form-control oracle (fixtures/form-oracle.js) in Chromium: live
// checkedness, option selectedness, a single select's own choice of option and
// FormData are the browser's, where JSDOM's can differ. The server markup is
// rendered here, in Node, and parsed in the page next to the equivalent static
// HTML; the client paths run in the page with the development runtime. The
// part run is every shape with a checkedness or a selection (checkbox, radio
// group, single and multiple selects), every field named after or given the
// id of a member of its form (only a browser lets it stand in for the
// member), plus every tenth other shape, on every client path, each
// hydration also after a user edit made before it runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { installDOM } from '../../../test-utils/dom.js';
import { shapes, jsxModule, hComponent, isDynamic, editsEarly } from './fixtures/form-oracle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

const browserAvailable = await chromiumLaunches(chromium);

const textual = (s) => s.control === 'text' || s.control === 'textarea' || s.control === 'range';
const SHAPES = shapes().filter((s) => !textual(s) || s.id % 10 === 0 || s.name !== undefined || s.fieldId !== undefined);
const AUTHORINGS = ['h', 'compiled', 'spread', 'wrapped'];
// The server markup each authoring hydrates: a wrapped field's wrappers
// render elements of their own.
const SOURCES = {
  h: ['h:hydratable', 'h:stream', 'compiled:hydratable', 'spread:hydratable'],
  compiled: ['h:hydratable', 'h:stream', 'compiled:hydratable', 'spread:hydratable'],
  spread: ['h:hydratable', 'h:stream', 'compiled:hydratable', 'spread:hydratable'],
  wrapped: ['wrapped:hydratable', 'wrapped:stream'],
};
const LETTER = { compiled: 'C', spread: 'S', wrapped: 'W' };

// Every server render the page parses: `${id}|${authoring}|${renderer}`.
async function serverMarkup() {
  installDOM();
  const { h, signal, For, Show } = await import('../../core/src/index.js');
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
      const Component = authoring === 'h' ? hComponent(h, shape, { For, Show }) : server[`${LETTER[authoring]}${shape.id}`];
      for (const [name, render] of Object.entries(renderers)) {
        markup[`${shape.id}|${authoring}|${name}`] = await render(h(Component, { v: isDynamic(shape) ? signal(shape.initial) : undefined, o: signal(editsEarly(shape)), l: signal(false) }));
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
    import { _resetForm, _changedFields } from ${JSON.stringify(path.join(root, 'packages/core/src/dom.js'))};
    import * as oracle from ${JSON.stringify(path.join(here, 'fixtures/form-oracle.js'))};
    import * as client from './client.mjs';
    import * as hydratable from './hydratable.mjs';
    const changedFields = (el) => {
      const out = [];
      _changedFields(el, out, new WeakSet());
      return out.length;
    };
    const env = { h: core.h, mount: core.mount, hydrate: core.hydrate, flushSync: core.flushSync, signal: core.signal, resetForm: _resetForm, changedFields, For: core.For, Show: core.Show, document };
    const byId = new Map(oracle.shapes().map((s) => [s.id, s]));
    const letter = { compiled: 'C', spread: 'S', wrapped: 'W' };
    const component = (shape, authoring, build) => authoring === 'h' ? oracle.hComponent(core.h, shape, env) : build[letter[authoring] + shape.id];
    export async function run(ids, markup, authorings, sources) {
      const findings = [];
      let server = 0;
      let clients = 0;
      for (const id of ids) {
        const shape = byId.get(id);
        for (const authoring of authorings) {
          for (const renderer of oracle.editsEarly(shape) ? ['string', 'hydratable', 'stream'] : []) {
            server++;
            const found = oracle.checkServerHtml(env, shape, markup[id + '|' + authoring + '|' + renderer]);
            if (found) findings.push({ shape, authoring, renderer, ...found });
          }
          clients++;
          const mounted = await oracle.runClient(env, shape, component(shape, authoring, client));
          if (mounted) findings.push({ shape, path: authoring + ' mount', ...mounted });
          for (const source of sources[authoring]) {
            clients++;
            const [from, renderer] = source.split(':');
            const html = markup[id + '|' + from + '|' + renderer];
            const found = await oracle.runClient(env, shape, component(shape, authoring, hydratable), html);
            if (found) findings.push({ shape, path: authoring + ' hydrating ' + source, ...found });
            if (!oracle.editsEarly(shape)) continue;
            clients++;
            const early = await oracle.runClient(env, shape, component(shape, authoring, hydratable), html, true);
            if (early) findings.push({ shape, path: authoring + ' hydrating ' + source + ', edited before', ...early });
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
