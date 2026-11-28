// React islands that native code swaps or removes after the page hydrated.
// Hydration hands an island the server's region, and the island replaces the
// server's HTML between the region's markers with its client render once the
// walk is done. The native code around it (a conditional, a keyed list)
// recorded the server's nodes during the walk, so when it later drops the
// island, the island has to take its own nodes out.
// Run: node --test packages/react-compat/test/island-hydration.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
globalThis.__WHAT_DEV__ = true;

const here = path.dirname(fileURLToPath(import.meta.url));
const pk = path.resolve(here, '../..');
const babel = createRequire(createRequire(import.meta.url).resolve('what-compiler'))('@babel/core');
const { lowerJsx } = await import('../src/mixed-plugin.js');
const plugin = (await import(path.join(pk, 'compiler/src/babel-plugin.js'))).default;
const CORE = path.join(pk, 'core/src/index.js');
const RENDER = path.join(pk, 'core/src/render.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'what-island-hydration-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

fs.writeFileSync(path.join(tmp, 'react-bits.mjs'), `
import { createElement as h, useState, useEffect } from ${JSON.stringify(path.join(pk, 'react-compat/src/index.js'))};
export function Icon({ name }) {
  useEffect(() => { globalThis.__icons.push('+' + name); return () => { globalThis.__icons.push('-' + name); }; }, []);
  return h('svg', { className: 'icon icon-' + name }, h('path', { d: 'M0 0' }));
}
export function Chip({ label }) {
  const [c, setC] = useState(0);
  return h('li', { className: 'chip', onClick: () => setC(c + 1) }, label + ':' + c);
}
`);

// A native page: React tags become islands (the mixed plugin's lowering).
const PAGE = `
import { signal } from 'what-framework';
import { Icon, Chip } from 'REACT';
export const open = signal(false);
export const tags = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
export function Page() {
  return (
    <main>
      <button id="menu">{open() ? <Icon name="x" /> : <Icon name="menu" />}</button>
      <ul>{tags().map((t) => <Chip key={t.id} label={t.name} />)}</ul>
      <p>after</p>
    </main>
  );
}`;

let built = 0;
function build(opts) {
  const ast = babel.parseSync(PAGE, { filename: 'page.jsx', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  lowerJsx(babel, ast, { reactFile: false, reactTags: new Set(['Icon', 'Chip']), nativeTags: new Set() });
  const mixed = babel.transformFromAstSync(ast, PAGE, { configFile: false, babelrc: false }).code;
  const code = babel.transformSync(mixed, {
    filename: 'page.jsx', configFile: false, babelrc: false,
    plugins: [[plugin, { production: false, ...opts }]], parserOpts: { plugins: ['jsx'] },
  }).code
    .replace(/(['"])what-framework\/render\1/g, JSON.stringify(RENDER))
    .replace(/(['"])what-framework\/([\w-]+)\1/g, (_, _q, sub) => JSON.stringify(path.join(pk, 'what/src', sub + '.js')))
    .replace(/(['"])what-framework\1/g, JSON.stringify(CORE))
    .replace(/(['"])what-react\/mixed\1/g, JSON.stringify(path.join(pk, 'react-compat/src/mixed.js')))
    .replace(/(['"])REACT\1/g, JSON.stringify(path.join(tmp, 'react-bits.mjs')));
  const file = path.join(tmp, `page-${built++}.mjs`);
  fs.writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

const server = await import(path.join(pk, 'server/src/index.js'));
const { h, flushSync } = await import(CORE);
// Compiled without what-react's Vite plugin, which adds the call that installs
// island hydration to each module compiled for hydration: installed here, as
// a build without the plugin does (MIXED.md). Without adoption, the islands
// claim the server's regions and render over them.
const { _claimIslands } = await import(path.join(pk, 'react-compat/src/mixed.js'));
_claimIslands();
const { hydrate } = await import(RENDER);
const ssr = await build({ generate: 'ssr' });
const client = await build({ hydratable: true, devMetadata: true, projectRoot: tmp });
const settle = async () => { flushSync(); await new Promise((r) => setTimeout(r, 0)); flushSync(); await new Promise((r) => setTimeout(r, 0)); };

async function hydratedPage() {
  globalThis.__icons = [];
  client.open(false);
  client.tags([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
  const html = server.renderToHydratableString(h(ssr.Page));
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const app = document.getElementById('app');
  const dispose = hydrate(h(client.Page), app);
  await settle();
  return { app, dispose, html };
}
const icons = (app) => [...app.querySelectorAll('#menu svg')].map((s) => s.getAttribute('class'));
const chips = (app) => [...app.querySelectorAll('.chip')].map((li) => li.textContent);

test('a conditional between two islands shows one of them after it flips on a hydrated page', async () => {
  const { app, html } = await hydratedPage();
  assert.match(html, /<button id="menu"><!--\$--><!--\[\]--><svg class="icon icon-menu">/, 'the server rendered the island inside the conditional');
  assert.deepEqual(icons(app), ['icon icon-menu']);

  client.open(true);
  await settle();
  assert.deepEqual(icons(app), ['icon icon-x'], 'the first island left the page');
  assert.deepEqual(globalThis.__icons, ['+menu', '-menu', '+x'], 'and was unmounted');

  client.open(false);
  await settle();
  assert.deepEqual(icons(app), ['icon icon-menu']);
  assert.equal(app.querySelector('p').textContent, 'after');
});

test('a keyed row that is a React island leaves the page when its item is removed on a hydrated page', async () => {
  const { app } = await hydratedPage();
  assert.deepEqual(chips(app), ['a:0', 'b:0', 'c:0']);
  app.querySelectorAll('.chip')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  assert.deepEqual(chips(app), ['a:0', 'b:0', 'c:1'], 'the hydrated island is live');

  client.tags([{ id: 1, name: 'a' }, { id: 3, name: 'c' }]);
  await settle();
  assert.deepEqual(chips(app), ['a:0', 'c:1'], 'the removed row is gone and the kept one has its state');

  client.tags([]);
  await settle();
  assert.deepEqual(chips(app), []);
  assert.equal(app.querySelector('ul').querySelectorAll('li').length, 0);
});
