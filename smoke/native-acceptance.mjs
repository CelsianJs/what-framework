#!/usr/bin/env node
// A deliberately bounded native-engine slice. No installs, external services,
// mocks, or fallback browser: missing WebKit must fail its qualification gate.
//   node smoke/native-acceptance.mjs --browser=webkit
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { h } from '../packages/core/src/h.js';
import { renderToString } from '../packages/server/src/node.js';
import { Island } from '../packages/server/src/islands.js';
import { launchBrowser } from './harness/index.mjs';

const browserName = process.argv.find((a) => a.startsWith('--browser='))?.slice(10) || 'webkit';
const ssr = renderToString(h('div', { id: 'fixture' },
  h('button', { id: 'increment' }, 'Count:0'),
  h('label', {}, 'Name', h('input', { id: 'name', value: 'server' })),
  h('output', { id: 'name-value' }, 'server'),
  h('label', {}, 'A', h('input', { id: 'radio-a', type: 'radio', name: 'choice', value: 'a', checked: true })),
  h('label', {}, 'B', h('input', { id: 'radio-b', type: 'radio', name: 'choice', value: 'b', checked: false })),
  h('output', { id: 'choice' }, 'a'),
  h('svg', { viewBox: '0 0 20 20', width: '20', height: '20' }, h('circle', { id: 'dot', cx: '5', cy: '5', r: '2' })),
));
const islandHTML = renderToString(Island({
  name: 'native-island', mode: 'visible', children: [h('button', { id: 'island-button' }, 'Island:0')],
}));
const source = `
  import { h, signal, hydrate, flushSync } from 'what-core';
  import { island, hydrateIslands } from 'what-server/islands';
  const count = signal(0), name = signal('server'), choice = signal('a');
  window.before = { root: document.getElementById('fixture'), input: document.getElementById('name'), island: document.getElementById('island-button') };
  function App() {
    return h('div', { id: 'fixture' },
      h('button', { id: 'increment', onclick: () => { count(count() + 1); flushSync(); } }, () => 'Count:' + count()),
      h('label', {}, 'Name', h('input', { id: 'name', value: name, oninput: e => { name(e.target.value); flushSync(); } })),
      h('output', { id: 'name-value' }, name),
      h('label', {}, 'A', h('input', { id: 'radio-a', type: 'radio', name: 'choice', value: 'a', checked: () => choice() === 'a', onchange: () => { choice('a'); flushSync(); } })),
      h('label', {}, 'B', h('input', { id: 'radio-b', type: 'radio', name: 'choice', value: 'b', checked: () => choice() === 'b', onchange: () => { choice('b'); flushSync(); } })),
      h('output', { id: 'choice' }, choice),
      h('svg', { viewBox: '0 0 20 20', width: '20', height: '20' }, h('circle', { id: 'dot', cx: () => String(count() + 5), cy: '5', r: '2' })),
    );
  }
  hydrate(h(App, {}), document.getElementById('app'));
  function Counter() {
    const clicks = signal(0);
    return h('button', { id: 'island-button', onclick: () => { clicks(clicks() + 1); flushSync(); } }, () => 'Island:' + clicks());
  }
  island('native-island', () => ({ default: Counter }), { mode: 'visible' });
  hydrateIslands();
  window.nativeReady = true;
`;
const bundle = await build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'native-acceptance.js' },
  bundle: true, write: false, platform: 'browser', format: 'esm', conditions: ['browser'],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const html = `<!doctype html><html><head><title>What native acceptance</title></head><body><main id="app">${ssr}</main><aside>${islandHTML}</aside><script type="module" src="/client.js"></script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === '/client.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(bundle.outputFiles[0].text);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  }
});
let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  browser = await launchBrowser({ browserName });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.nativeReady === true);
  assert.equal(await page.title(), 'What native acceptance');
  assert.equal(await page.locator('#increment').textContent(), 'Count:0');
  assert.equal(await page.evaluate(() => window.before.root === document.getElementById('fixture') && window.before.input === document.getElementById('name')), true, 'hydration must retain SSR nodes');
  await page.locator('#name').fill('native input');
  assert.equal(await page.locator('#name-value').textContent(), 'native input', 'input events must update controlled state');
  await page.locator('#radio-b').check();
  assert.equal(await page.locator('#radio-a').isChecked(), false);
  assert.equal(await page.locator('#choice').textContent(), 'b', 'radio values must not be overwritten by the checked accessor');
  await page.locator('#increment').click();
  assert.equal(await page.locator('#increment').textContent(), 'Count:1');
  assert.equal(await page.locator('#dot').getAttribute('cx'), '6');
  assert.equal(await page.locator('#dot').evaluate((el) => el.namespaceURI), 'http://www.w3.org/2000/svg');
  await page.waitForFunction(() => !document.querySelector('[data-island="native-island"]'));
  assert.equal(await page.evaluate(() => window.before.island === document.getElementById('island-button')), true, 'visible island must preserve SSR button');
  await page.locator('#island-button').click();
  assert.equal(await page.locator('#island-button').textContent(), 'Island:1');
  assert.deepEqual(errors, [], 'native browser must report no uncaught or console errors');
  console.log(`[native-acceptance] ${browserName}: hydration, input, radio, events, SVG and visible island passed`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
