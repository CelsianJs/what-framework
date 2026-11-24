// A native page with React islands, rendered on the server and hydrated.
// The server renders each island's React elements once, with React's server
// rules (initial state, no effects, <Suspense> fallbacks, server snapshots),
// native components inside included. Hydration adopts the server's native
// nodes, hands each island its server region, and the island replaces it with
// its client render right after the walk, with no mismatch.
// Run: node --test packages/react-compat/test/
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'what-mixed-ssr-'));
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

test('the server renders React islands with React rules, native components inside them included', () => {
  globalThis.__effectRan = 0;
  const html = server.renderToString(h(ssr.Page));
  assert.equal(html,
    '<main><h1>Title 1</h1>'
    + '<button class="clicker" style="margin-top:4px;opacity:0.5">n1:0</button>'
    + '<section class="panel"><h2>P1</h2><em>dark</em></section>'
    + '<i class="fallback">loading</i>'
    + '<b class="store">server</b>'
    + '<p>after</p></main>');
  assert.equal(globalThis.__effectRan, 0, 'effects never run on the server');
});

test('a React component that throws on the server leaves its island to the browser; the page still renders', () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    assert.equal(server.renderToString(h(ssr.Broken)), '<main><h1>ok</h1><p>after</p></main>');
  } finally {
    console.warn = warn;
  }
  assert.ok(warnings.some((w) => w.includes('boom on the server')), warnings.join('\n'));
});

test('hydration adopts the native nodes and replaces each island with its client render, with no mismatch', async () => {
  const html = server.renderToHydratableString(h(ssr.Page));
  assert.match(html, /<!--\[\]--><button [^>]*class="clicker"[^>]*>n1:0<\/button><!--\/\[\]-->/, 'each island is bracketed');
  assert.match(html, /<section data-hk="\w+" class="panel"><h2>P1<\/h2><!--\[\]--><em>dark<\/em><!--\/\[\]--><\/section>/, 'a nested island inside a native component has its own brackets');

  document.body.innerHTML = `<div id="app">${html}</div>`;
  const app = document.getElementById('app');
  const h1 = app.querySelector('h1');
  const p = app.querySelector('p');
  const serverButton = app.querySelector('button');
  globalThis.__effectRan = 0;
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    hydrate(h(client.Page), app);
    await settle();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, []);
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), []);
  assert.equal(app.querySelector('h1'), h1, 'native server nodes adopted');
  assert.equal(app.querySelector('p'), p);
  const button = app.querySelector('button');
  assert.notEqual(button, serverButton, 'the island is the client render now');
  assert.equal(button.textContent, 'n1:0');
  assert.equal(app.querySelectorAll('button').length, 1, 'the server HTML was replaced, not duplicated');
  assert.equal(app.querySelector('.panel h2').textContent, 'P1');
  assert.equal(app.querySelector('.panel em').textContent, 'dark', 'React context through the native panel');
  assert.equal(app.querySelector('.store').textContent, 'client', 'the client snapshot after hydration');
  assert.equal(globalThis.__effectRan, 1, 'effects run once, on the client');

  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal(app.querySelector('button').textContent, 'n1:1', 'interactive');
  client.n(2);
  await settle();
  assert.equal(app.querySelector('h1').textContent, 'Title 2');
  assert.equal(app.querySelector('button').textContent, 'n2:1', 'React state kept across a native update');
  assert.equal(app.querySelector('.panel h2').textContent, 'P2');
});

test('the streaming renderer and the async renderer write the same islands', async () => {
  const stream = server.renderToStream(h(ssr.Page));
  let html = '';
  if (typeof stream[Symbol.asyncIterator] === 'function') for await (const chunk of stream) html += chunk;
  else {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (let r = await reader.read(); !r.done; r = await reader.read()) html += typeof r.value === 'string' ? r.value : decoder.decode(r.value);
  }
  assert.match(html, /<!--\[\]--><button [^>]*class="clicker"[^>]*>n1:0<\/button><!--\/\[\]-->/);
  assert.match(html, /<em>dark<\/em>/);
  const { body } = await server.renderToStringAsync(h(ssr.Page));
  assert.match(body, /<!--\[\]--><button [^>]*class="clicker"[^>]*>n1:0<\/button><!--\/\[\]-->/);
});

test('React components as rows of a native keyed list hydrate and keep their state by key', async () => {
  const html = server.renderToHydratableString(h(ssr.Tags));
  document.body.innerHTML = `<div id="tags">${html}</div>`;
  const host = document.getElementById('tags');
  const ul = host.querySelector('ul');
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    hydrate(h(client.Tags), host);
    await settle();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, []);
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), [], 'no mismatch');
  assert.equal(host.querySelector('ul'), ul);
  const texts = () => [...host.querySelectorAll('li')].map((li) => li.textContent).join(' ');
  assert.equal(texts(), 'a:0 b:0');
  host.querySelector('li').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  client.tags([{ id: 3, name: 'c' }, ...client.tags().map((t) => (t.id === 1 ? { ...t, name: 'a2' } : t))]);
  await settle();
  assert.equal(texts(), 'c:0 a2:1 b:0');
});
