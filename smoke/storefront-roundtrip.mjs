import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './harness/index.mjs';
import { asDocument, loadStorefront, modes, serverPage, storefrontCode } from '../packages/server/test/fixtures/storefront-roundtrip.js';
import { updatedState } from '../packages/server/test/fixtures/storefront-observations.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const fixtureDir = fileURLToPath(new URL('../packages/server/test/fixtures/', import.meta.url));

async function bundle(target) {
  const source = await storefrontCode(target);
  const result = await build({
    stdin: {
      contents: source + '\n' + `
        import { exerciseStorefront } from './storefront-client.js';
        window.runStorefront = mode => exerciseStorefront(createStorefront, mode);
      `,
      resolveDir: fixtureDir,
    },
    absWorkingDir: repo, bundle: true, write: false, platform: 'browser', format: 'esm',
    define: { __WHAT_DEV__: 'true' },
  });
  return result.outputFiles[0].text;
}

async function runPage(browser, html, mode, client) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', event => errors.push(event.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url === 'http://storefront.test/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url === 'http://storefront.test/client.js') return route.fulfill({ contentType: 'text/javascript', body: client });
      return route.abort();
    });
    await page.goto('http://storefront.test/');
    await page.addScriptTag({ url: 'http://storefront.test/client.js', type: 'module' });
    const result = await page.evaluate(mode => window.runStorefront(mode), mode);
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await page.close();
  }
}

test('Chromium storefront server entry points', { timeout: 90_000 }, async t => {
  const browser = await launchBrowser();
  try {
    const [compiled, vnode, hydratable] = await Promise.all([bundle('dom'), bundle('jsx-runtime'), bundle('hydratable')]);
    const fresh = await runPage(browser, '<!doctype html><body></body>', 'client', compiled);
    assert.deepEqual(fresh.interaction, updatedState);
    assert.equal(fresh.optimisticLike, 'Likes 1');
    const clients = { 'jsx-runtime': vnode, hydratable };
    for (const [clientName, client] of Object.entries(clients)) {
      for (const target of ['jsx-runtime', 'ssr']) {
        const fixture = await loadStorefront(target);
        for (const mode of modes) {
          await t.test(`${clientName} client / ${target} server / ${mode}`, async () => {
            const { html } = await serverPage(fixture, mode);
            const result = await runPage(browser, asDocument(html, mode), mode, client);
            const sync = mode === 'string' || mode === 'hydratable';
            assert.deepEqual(result.settled, fresh.settled);
            assert.deepEqual(result.replaced, sync ? ['stock-fallback'] : []);
            assert.deepEqual(result.interaction, updatedState);
            assert.deepEqual(result.fetches, sync ? ['stock', 'rating', 'delivery'] : []);
            assert.equal(result.optimisticLike, 'Likes 1', 'the optimistic count shows before the save lands');
            assert.deepEqual(result.events, []);
            assert.deepEqual(result.warnings, []);
            assert.equal(result.retainedAfterSort, true);
            // Matching markup is adopted without a node added, on every pair.
            if (!sync) assert.equal(result.created, 0);
          });
        }
      }
    }
  } finally {
    await browser.close();
  }
});
