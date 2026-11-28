// React islands of a page compiled as an app is compiled (the mixed plugin's
// lowering, what-compiler's server and hydratable output), hydrated with
// island adoption installed, as what-react's Vite plugin installs it in a
// hydratable build: every element and text node of every island is the
// server's, and the page behaves as one the browser rendered.
// Run: node --test packages/react-compat/test/island-adopt-compiled.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM();
globalThis.__WHAT_DEV__ = true;

const here = path.dirname(fileURLToPath(import.meta.url));
const pk = path.resolve(here, '../..');
const babel = createRequire(createRequire(import.meta.url).resolve('what-compiler'))('@babel/core');
const { lowerJsx } = await import('../src/mixed-plugin.js');
const plugin = (await import(path.join(pk, 'compiler/src/babel-plugin.js'))).default;
const CORE = path.join(pk, 'core/src/index.js');
const RENDER = path.join(pk, 'core/src/render.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'what-island-adopt-compiled-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// React components, as an npm package or a React file would give them.
fs.writeFileSync(path.join(tmp, 'react-bits.mjs'), `
import { createElement as h, useState, useEffect, useContext, createContext, useSyncExternalStore, lazy, Suspense } from ${JSON.stringify(path.join(pk, 'react-compat/src/index.js'))};
export function Clicker({ label }) {
  const [c, setC] = useState(0);
  useEffect(() => { globalThis.__effectRan = (globalThis.__effectRan || 0) + 1; }, []);
  return h('button', { className: 'clicker', style: { marginTop: 4, opacity: 0.5 }, onClick: () => setC(c + 1) }, label + ':' + c);
}
const Theme = createContext('none');
export function ThemeProvider({ theme, children }) { return h(Theme.Provider, { value: theme }, children); }
export function ThemeLabel() { return h('em', null, useContext(Theme)); }
const Never = lazy(() => new Promise(() => {}));
export function Waits() { return h(Suspense, { fallback: h('i', { className: 'fallback' }, 'loading') }, h(Never)); }
export function StoreValue() {
  const v = useSyncExternalStore(() => () => {}, () => 'client', () => 'server');
  return h('b', { className: 'store' }, v);
}
export function Boom() { throw new Error('boom on the server'); }
export function Chip({ label }) {
  const [c, setC] = useState(0);
  return h('li', { onClick: () => setC(c + 1) }, label + ':' + c);
}
`);

// A native page: React tags become islands (the mixed plugin's lowering).
const PAGE = `
import { signal } from 'what-framework';
import { Clicker, ThemeProvider, ThemeLabel, Waits, StoreValue, Boom, Chip } from 'REACT';
export const n = signal(1);
export const tags = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
export function Tags() {
  return <ul>{tags().map((t) => <Chip key={t.id} label={t.name} />)}</ul>;
}
function Panel(props) {
  return <section class="panel"><h2>{props.title}</h2><ThemeLabel /></section>;
}
export function Page() {
  return (
    <main>
      <h1>Title {n()}</h1>
      <Clicker label={'n' + n()} />
      <ThemeProvider theme="dark"><Panel title={'P' + n()} /></ThemeProvider>
      <Waits />
      <StoreValue />
      <p>after</p>
    </main>
  );
}
export function Broken() {
  return <main><h1>ok</h1><Boom /><p>after</p></main>;
}`;

let built = 0;
function build(opts) {
  const ast = babel.parseSync(PAGE, { filename: 'page.jsx', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  lowerJsx(babel, ast, { reactFile: false, reactTags: new Set(['Clicker', 'ThemeProvider', 'ThemeLabel', 'Waits', 'StoreValue', 'Boom', 'Chip']), nativeTags: new Set() });
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
const { h, flushSync, getDiagnostics } = await import(CORE);
const { hydrate } = await import(RENDER);
const ssr = await build({ generate: 'ssr' });
const client = await build({ hydratable: true, devMetadata: true, projectRoot: tmp });
const settle = async () => { flushSync(); await new Promise((r) => setTimeout(r, 0)); };

const { _hydrateIslands } = await import(path.join(pk, 'react-compat/src/mixed.js'));
_hydrateIslands();

const nodesOf = (root) => {
  const out = [];
  const walker = document.createTreeWalker(root, 5);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n);
  return out;
};

test('every island of a compiled page adopts the server\'s nodes, with no mismatch', async () => {
  const html = server.renderToHydratableString(h(ssr.Page));
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const app = document.getElementById('app');
  const before = new Set(nodesOf(app));
  const serverButton = app.querySelector('button');
  globalThis.__effectRan = 0;
  const warnings = [];
  const records = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    hydrate(h(client.Page), app, { onHydrationError: (info) => records.push(info) });
    await settle();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, []);
  assert.deepEqual(records, []);
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), []);
  const created = nodesOf(app).filter((n) => !before.has(n));
  // The native <Panel> inside the ThemeProvider island is built again (what
  // native What renders inside an island is not adopted yet), and the
  // <Suspense> that waits on the server renders its fallback afresh.
  const panel = app.querySelector('.panel');
  const fresh = created.filter((n) => !(panel.contains(n)) && !(n.nodeType === 1 && n.matches('i.fallback')) && !(n.parentNode && n.parentNode.matches && n.parentNode.matches('i.fallback')));
  assert.deepEqual(fresh.map((n) => n.nodeName + ':' + n.textContent), [], 'only the native panel and the fallback are new');
  assert.equal(app.querySelector('button'), serverButton, 'the island\'s button is the server\'s');
  assert.equal(serverButton.textContent, 'n1:0');
  assert.equal(app.querySelector('.panel em').textContent, 'dark', 'React context through the native panel');
  assert.equal(app.querySelector('.store').textContent, 'client', 'the client snapshot after hydration');
  assert.equal(globalThis.__effectRan, 1, 'effects run once, on the client');

  serverButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal(serverButton.textContent, 'n1:1', 'interactive');
  client.n(2);
  await settle();
  assert.equal(app.querySelector('h1').textContent, 'Title 2');
  assert.equal(app.querySelector('button'), serverButton);
  assert.equal(serverButton.textContent, 'n2:1', 'React state kept across a native update');
  assert.equal(app.querySelector('.panel h2').textContent, 'P2');
});

test('React components as rows of a native keyed list adopt their server nodes and keep their state by key', async () => {
  client.tags([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  const html = server.renderToHydratableString(h(ssr.Tags));
  document.body.innerHTML = `<div id="tags">${html}</div>`;
  const host = document.getElementById('tags');
  const serverRows = [...host.querySelectorAll('li')];
  hydrate(h(client.Tags), host);
  await settle();
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), [], 'no mismatch');
  assert.deepEqual([...host.querySelectorAll('li')], serverRows, 'the rows are the server\'s');
  const texts = () => [...host.querySelectorAll('li')].map((li) => li.textContent).join(' ');
  host.querySelector('li').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  client.tags([{ id: 3, name: 'c' }, ...client.tags().map((t) => (t.id === 1 ? { ...t, name: 'a2' } : t))]);
  await settle();
  assert.equal(texts(), 'c:0 a2:1 b:0');
  assert.equal(host.querySelectorAll('li')[1], serverRows[0], 'a kept row is still the server\'s element');
});
