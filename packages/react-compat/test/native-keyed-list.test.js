// A keyed list of React elements that native What code places itself: a What
// component maps an array to elements a React file made (`{rows(order())}`).
// React keeps a keyed child from one render to the next, so a row that stays
// keeps its DOM node, its state, the text typed in it and the focus when an
// item is inserted ahead of it, and a row whose key goes is unmounted.
//
// A production build is what can tell: without a vnode made by native code
// (compiled JSX makes none) the bundle has no what-core vnode renderer, and
// what-react installs its own (mixed.js holeRows, which a React file's
// lowered JSX brings in), which keeps a row's island by key and type, and
// renders the row's new props into it.
// With one (native code calling h()) what-core's keyed rows keep the
// elements, while their props stay the same (a row whose vnode changed is
// built again there: render.js sameVNode). Both are built here through Vite
// (what-compiler's what() and reactCompat()) and run in jsdom.
// Run: node --test packages/react-compat/test/native-keyed-list.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { reactCompat } from '../src/vite-plugin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const what = (await import(path.join(REPO, 'packages/compiler/src/vite-plugin.js'))).default;
const FRAMEWORK = { 'what-framework': 'what', 'what-core': 'core', 'what-router': 'router', 'what-server': 'server', 'what-react': 'react-compat' };

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'what-react-keyed-')));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// Installed packages (not workspace links), so the plugin tells the app's
// React file from its native files the way it does in an installed project.
const root = path.join(scratch, 'app');
for (const [pkg, dir] of Object.entries(FRAMEWORK)) {
  for (const entry of ['package.json', 'src']) {
    fs.cpSync(path.join(REPO, 'packages', dir, entry), path.join(root, 'node_modules', pkg, entry), { recursive: true });
  }
}

const native = (extra, list, tag) => `import { signal, mount${extra ? ', h' : ''} } from 'what-framework';
import { ${list}${tag ? ', ReactList' : ''} } from './rows.jsx';
const order = signal(['a', 'b']);
function App() {
  return <main><section id="list">{${list}(order())}</section>${tag ? '<ReactList order={order()} />' : ''}</main>;
}
${extra ? "window.__vnode = h('i', null);\n" : ''}window.__order = order;
window.__unmount = mount(<App />, '#app');
`;
const files = {
  'package.json': JSON.stringify({ name: 'app', type: 'module' }),
  // A React file: the rows, and the function a native component calls to get them.
  'src/rows.jsx': `import { useState, useEffect } from 'react';
export function Row({ id, label }) {
  const [count, setCount] = useState(0);
  useEffect(() => () => window.__log.push('unmount ' + id), []);
  return (
    <div data-row={id}>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <input defaultValue={id} />
      <i>{label}</i>
    </div>
  );
}
// Rows whose props stay the same, and rows whose label changes with the list.
export const rows = (order) => order.map((id) => <Row key={id} id={id} label={id} />);
export const countedRows = (order) => order.map((id) => <Row key={id} id={id} label={id + order.length} />);
// The same list placed by a React parent, which native code renders as a tag.
export const ReactList = ({ order }) => <aside>{rows(order.map((id) => id + '!'))}</aside>;
// An element beside a list, with a key one of the list's rows has.
export const solo = () => <Row key="a" id="a" label="solo" />;
`,
  // Two lists that share keys, in one hole and in two.
  'src/multi.jsx': `import { signal, mount } from 'what-framework';
import { rows, solo } from './rows.jsx';
const order = signal(['x', 'a', 'b']);
function App() {
  return (
    <main>
      <section id="nested">{[rows(order()), rows(['a', 'b'])]}</section>
      <section id="deep">{[[rows(order())], [[rows(['a', 'b'])]]]}</section>
      <section id="sibling">{[rows(order()), solo()]}</section>
      <section id="frag"><>{rows(order())}{rows(['a', 'b'])}</></section>
    </main>
  );
}
window.__order = order;
window.__unmount = mount(<App />, '#app');
`,
  // Native code that makes no vnode, and native code that does.
  'src/compiled.jsx': native(false, 'countedRows'),
  // The verifier's app: the native list next to a React tag (an island).
  'src/tagged.jsx': native(false, 'rows', true),
  'src/vnode.jsx': native(true, 'rows'),
};
for (const [rel, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

async function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
}

async function clientBuild(entry) {
  const outDir = path.join(root, `dist-${entry}`);
  await quiet(() => build({
    root, configFile: false, logLevel: 'silent',
    plugins: [what({ prodBundles: false }), reactCompat()],
    // From the packages' source (the copies here have no dist): the client
    // conditions without `production` and `module` (bundle.test.js).
    resolve: { conditions: ['browser'] },
    build: { outDir, emptyOutDir: true, modulePreload: false, rollupOptions: { input: path.join(root, 'src', `${entry}.jsx`) } },
  }));
  const assets = path.join(outDir, 'assets');
  return path.join(assets, fs.readdirSync(assets).find((f) => f.startsWith(`${entry}-`) && f.endsWith('.js')));
}

const bundles = { compiled: await clientBuild('compiled'), tagged: await clientBuild('tagged'), vnode: await clientBuild('vnode'), multi: await clientBuild('multi') };

const { installDOM } = await import(path.join(REPO, 'test-utils/dom.js'));
installDOM();
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

async function drive(bundle) {
  document.body.innerHTML = '<div id="app"></div>';
  window.__log = [];
  const printed = [];
  const { error, warn } = console;
  console.error = (...args) => printed.push(`error: ${args.join(' ')}`);
  console.warn = (...args) => printed.push(`warn: ${args.join(' ')}`);
  try {
    await import(pathToFileURL(bundle).href);
    await settle();
    const list = document.getElementById('list');
    const ids = () => [...list.querySelectorAll('[data-row]')].map((el) => el.dataset.row).join('');
    const labels = () => [...list.querySelectorAll('i')].map((el) => el.textContent).join(' ');
    const row = list.querySelector('[data-row=a]');
    const input = row.querySelector('input');
    row.querySelector('button').click();
    await settle();
    input.focus();
    input.value = 'typed';

    // An item inserted ahead of row a.
    window.__order(['x', 'a', 'b']);
    await settle();
    const next = list.querySelector('[data-row=a]');
    const inserted = {
      order: ids(),
      labels: labels(),
      sameRow: next === row,
      sameInput: next.querySelector('input') === input,
      count: next.querySelector('button').textContent,
      value: next.querySelector('input').value,
      focused: document.activeElement === input,
    };

    // The rows moved: a keeps its state, and the focus and text selection.
    input.setSelectionRange(1, 3);
    window.__order(['b', 'a', 'x']);
    await settle();
    const moved = {
      order: ids(),
      sameRow: list.querySelector('[data-row=a]') === row,
      count: row.querySelector('button').textContent,
      focused: document.activeElement === input,
      selection: [input.selectionStart, input.selectionEnd],
    };

    // Keys that go are unmounted; the one that stays is kept.
    window.__order(['a']);
    await settle();
    const removed = { order: ids(), sameRow: list.querySelector('[data-row=a]') === row, log: window.__log.filter((line) => !line.endsWith('!')).sort() };

    window.__unmount();
    await settle();
    return { inserted, moved, removed, unmounted: { log: window.__log.filter((line) => !line.endsWith('!')).sort(), left: document.getElementById('app').innerHTML }, printed };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

function assertKept(r, labels, focusOnMove = true) {
  assert.deepEqual(r.printed, [], 'nothing printed');
  // React (react-dom 19): the same node, its state, the typed text and the focus.
  assert.deepEqual(r.inserted, {
    order: 'xab', labels, sameRow: true, sameInput: true, count: '1', value: 'typed', focused: true,
  });
  assert.deepEqual(r.moved, { order: 'bax', sameRow: true, count: '1', focused: focusOnMove, selection: [1, 3] });
  assert.deepEqual(r.removed, { order: 'a', sameRow: true, log: ['unmount b', 'unmount x'] });
  assert.deepEqual(r.unmounted, { log: ['unmount a', 'unmount b', 'unmount x'], left: '' });
}

test('native code that makes no vnode: a keyed list of React elements it places keeps each row by key (production build)', async () => {
  const code = fs.readFileSync(bundles.compiled, 'utf8');
  // The case this pins: no what-core vnode renderer in the bundle (its keyed
  // rows compare vnodes with sameVNode, whose `String(x) === String(y)` is
  // the only such comparison of two functions' text).
  assert.ok(!/String\(\w+\)\s*===\s*String\(\w+\)/.test(code), 'no what-core vnode renderer');
  // The row's new props rendered into the kept row.
  assertKept(await drive(bundles.compiled), 'x3 a3 b3');
});

test('native code that makes no vnode, next to a React tag: the native list keeps each row by key (production build)', async () => {
  assert.ok(!/String\(\w+\)\s*===\s*String\(\w+\)/.test(fs.readFileSync(bundles.tagged, 'utf8')), 'no what-core vnode renderer');
  assertKept(await drive(bundles.tagged), 'x a b');
});

test('native code that makes a vnode: what-core keeps the same list by key (production build)', async () => {
  assert.ok(/String\(\w+\)\s*===\s*String\(\w+\)/.test(fs.readFileSync(bundles.vnode, 'utf8')), 'what-core vnode renderer in the bundle');
  // what-core's keyed rows move the row, which takes its focus (what-core's
  // part, as the changed-props rebuild there is: MIXED.md, Limits).
  assertKept(await drive(bundles.vnode), 'x a b', false);
});

// Two lists in one hole that share a key, and a list beside an element with
// one of its keys: removing the first list's row never hands its node or its
// state to the other one, which keeps its own, as in React: each array of a
// hole is a key space of its own (mixed.js holeRows). More cases in
// native-keyed-scenes.test.js.
test('native code that makes no vnode: two keyed lists, or a list and an element, never take each other\'s rows (production build)', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  window.__log = [];
  await import(pathToFileURL(bundles.multi).href);
  await settle();
  const sections = ['nested', 'deep', 'sibling', 'frag'];
  const before = {};
  for (const id of sections) {
    const [first, second] = document.querySelectorAll(`#${id} [data-row=a]`);
    first.querySelector('input').value = 'first list';
    second.querySelector('input').value = 'second list';
    first.querySelector('button').click();
    before[id] = { first, second };
  }
  await settle();
  // Row a leaves the first list.
  window.__order(['x', 'b']);
  await settle();
  for (const id of sections) {
    const left = document.querySelectorAll(`#${id} [data-row=a]`);
    assert.equal(left.length, 1, id);
    const [a] = left;
    assert.notEqual(a, before[id].first, `${id}: not the first list's node`);
    assert.notEqual(a.querySelector('input').value, 'first list', `${id}: not the first list's text`);
    assert.equal(a.querySelector('button').textContent, '0', `${id}: not the first list's state`);
    assert.equal([...document.querySelectorAll(`#${id} [data-row]`)].map((el) => el.dataset.row).join(''), id === 'sibling' ? 'xba' : 'xbab', id);
  }
  // The second list's row (or the element beside the list) is its own, kept.
  for (const id of sections) {
    const kept = document.querySelector(`#${id} [data-row=a]`);
    assert.equal(kept, before[id].second, id);
    assert.equal(kept.querySelector('input').value, 'second list', id);
  }
  window.__unmount();
  await settle();
  assert.equal(document.getElementById('app').innerHTML, '');
});
