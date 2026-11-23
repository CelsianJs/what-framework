// The compiled-JSX hydration oracle (compiled-hydration-oracle.test.js) in
// Chromium, for the first CASES trees of its fixed seed: the same checks, with
// the browser's own parser, form controls and comment handling. The server
// markup is rendered here, in Node; the client builds run in the page with the
// development runtime. Every tree passes, as in JSDOM.

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
import { generateCase, random, quietly } from './fixtures/hydration-oracle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const browserAvailable = await chromiumLaunches(chromium);

const CASES = 40;
const SEED = 20261122;

function cases() {
  const next = random(SEED);
  return Array.from({ length: CASES }, (_, i) => generateCase(i, next));
}

async function serverMarkup(list) {
  const env = installDOM();
  try {
    const { h } = await import('../../core/src/index.js');
    const { __resetHydrationData } = await import('../../core/src/entries/internal.js');
    const { renderToHydratableString } = await import('../src/index.js');
    const markup = [];
    for (const { source } of list) {
      const server = await quietly(() => loadCompiled(source, { pluginOptions: { generate: 'ssr' } }));
      __resetHydrationData();
      markup.push(renderToHydratableString(h(server.Page)));
    }
    return markup;
  } finally {
    env.cleanup();
  }
}

async function pageBundle(dir, list) {
  const entries = { '': 'packages/core/src/index.js', '/render': 'packages/core/src/render.js', '/server': 'packages/server/src/index.js' };
  const rewrite = (code) => code.replace(/(['"])what-framework(\/render|\/server)?\1/g, (_, q, sub = '') =>
    JSON.stringify(path.join(root, entries[sub])));
  await quietly(() => list.forEach(({ source }, i) => writeFileSync(path.join(dir, `case${i}.mjs`), rewrite(compileJSX(source, { pluginOptions: { hydratable: true } })))));
  writeFileSync(path.join(dir, 'entry.mjs'), `
    import * as core from ${JSON.stringify(path.join(root, 'packages/core/src/index.js'))};
    import { __resetHydrationData } from ${JSON.stringify(path.join(root, 'packages/core/src/entries/internal.js'))};
    import { structure, editControls, readControls } from ${JSON.stringify(path.join(here, 'fixtures/hydration-oracle.js'))};
    ${list.map((_, i) => `import * as C${i} from './case${i}.mjs';`).join('\n')}
    const modules = [${list.map((_, i) => `C${i}`).join(', ')}];
    export function run(markup) {
      const findings = [];
      markup.forEach((html, id) => {
        const client = modules[id];
        __resetHydrationData();
        const host = document.createElement('div');
        const fresh = document.createElement('div');
        document.body.append(host, fresh);
        let stop = null;
        let stopFresh = null;
        try {
          host.innerHTML = html;
          const serverElements = [...host.querySelectorAll('*')];
          const edits = editControls(host);
          const problems = [];
          stop = core.hydrate(core.h(client.Page), host, { onHydrationError: (info) => problems.push(info.kind + ' at ' + info.path) });
          core.flushSync();
          if (problems.length > 0) return findings.push({ id, step: 'hydrate', problems });
          if (serverElements.some((el) => !el.isConnected)) return findings.push({ id, step: 'adopt' });
          if (JSON.stringify(readControls(host)) !== JSON.stringify(edits)) return findings.push({ id, step: 'edits' });
          const live = host.querySelector('div.live');
          client.n(client.n() + 1);
          core.flushSync();
          if (!live.isConnected || live.textContent !== String(client.n())) return findings.push({ id, step: 'write' });
          stopFresh = core.mount(core.h(client.Page), fresh);
          core.flushSync();
          if (structure(host.innerHTML) !== structure(fresh.innerHTML)) findings.push({ id, step: 'structure' });
        } catch (error) {
          findings.push({ id, step: 'threw', error: String(error && error.stack || error) });
        } finally {
          if (stop) stop();
          if (stopFresh) stopFresh();
          host.remove();
          fresh.remove();
          client.n(0);
        }
      });
      return findings;
    }
  `);
  // `development`: the packages' sources, the files the cases import, so a
  // <Form> from what-server shares the page's what-core.
  const bundle = await build({ entryPoints: [path.join(dir, 'entry.mjs')], bundle: true, format: 'iife', globalName: 'HydrationOracle', write: false,
    conditions: ['development'], define: { __WHAT_DEV__: 'true' }, logLevel: 'silent' });
  return bundle.outputFiles[0].text;
}

describe('compiled-JSX hydration oracle in Chromium', { skip: !browserAvailable }, () => {
  it(`the first ${CASES} trees of the fixed seed hydrate by adoption, keep every early edit, update in place and match a fresh mount`, async () => {
    const list = cases();
    const markup = await serverMarkup(list);
    const dir = mkdtempSync(path.join(tmpdir(), 'what-hydration-oracle-'));
    const browser = await chromium.launch();
    try {
      const script = await pageBundle(dir, list);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // A page with an origin, as an app's is: <Form> reads its CSRF cookie,
      // which a document with none (about:blank) refuses.
      await page.route('http://oracle.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
      await page.goto('http://oracle.test/');
      await page.addScriptTag({ content: script });
      await page.evaluate(() => { console.warn = () => {}; console.error = () => {}; });
      const findings = await page.evaluate((m) => globalThis.HydrationOracle.run(m), markup);
      console.log(`hydration oracle (Chromium): ${CASES} cases, ${findings.length} findings (${findings.map((f) => `#${f.id} ${f.step}`).join(', ')})`);
      assert.deepEqual(errors, []);
      assert.deepEqual(findings, []);
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
