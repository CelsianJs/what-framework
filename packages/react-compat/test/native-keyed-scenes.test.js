// Keyed React rows that native What code places, in the cases React's
// reconciler decides by array: each array of a hole is a key space of its
// own, a key that moves to another array mounts again, a list that empties
// and fills again mounts fresh rows (with or without a microtask between,
// and in one tick), a row whose key goes unmounts before the update returns,
// and the focus a move takes comes back only when nothing else took it.
//
// A production build with no what-core vnode renderer (compiled JSX, no h()):
// what-react installs its own, and a hole's value that holds a React element
// is placed by its keyed rows (mixed.js holeRows). Built through Vite (what()
// and reactCompat()), run in jsdom.
// Run: node --test packages/react-compat/test/native-keyed-scenes.test.js
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

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'what-react-scenes-')));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const root = path.join(scratch, 'app');
for (const [pkg, dir] of Object.entries(FRAMEWORK)) {
  for (const entry of ['package.json', 'src']) {
    fs.cpSync(path.join(REPO, 'packages', dir, entry), path.join(root, 'node_modules', pkg, entry), { recursive: true });
  }
}

const files = {
  'package.json': JSON.stringify({ name: 'app', type: 'module' }),
  'src/rows.jsx': `import { useState, useEffect } from 'react';
function Row({ id, list }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    window.log.push('+' + list + id);
    return () => window.log.push('-' + list + id);
  }, []);
  return (
    <div data-id={id} data-list={list}>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <input defaultValue={list + id} />
    </div>
  );
}
function Other(props) {
  return <Row {...props} />;
}
// A row per id; an id listed in \`others\` renders as another component type.
export const rows = (ids, list, others = []) => ids.map((id) => {
  const Type = others.includes(id) ? Other : Row;
  return <Type key={id} id={id} list={list} />;
});
export const solo = (list) => <Row key="a" id="a" list={list} />;
`,
  // One hole per scene, so each scene's arrays are the hole's own.
  'src/main.jsx': `import { signal, mount, flushSync } from 'what-framework';
import { rows, solo } from './rows.jsx';
const scene = signal('');
const sets = signal([[], [], []]);
const others = signal([]);
function Lists() {
  const s = scene();
  const [a, b, c] = sets();
  if (s === 'three') return [rows(a, 0), rows(b, 1), rows(c, 2)];
  if (s === 'flat') return rows(b, 1, others());
  if (s === 'nested') return [[rows(a, 0)], [[rows(b, 1)]]];
  if (s === 'sibling') return [rows(b, 1), solo(9)];
  return null;
}
function App() {
  return (
    <main>
      <section id="hole">{Lists()}</section>
      <section id="frag"><>{scene() === 'frag' ? rows(sets()[0], 0) : null}{scene() === 'frag' ? rows(sets()[1], 1) : null}</></section>
    </main>
  );
}
window.log = [];
window.start = (name, initial) => {
  window.log = [];
  scene(name);
  sets(initial);
  others([]);
  flushSync();
};
window.put = (next) => { sets(next); flushSync(); };
window.retype = (ids) => { others(ids); flushSync(); };
window.stop = mount(<App />, '#app');
`,
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

const outDir = path.join(root, 'dist');
await quiet(() => build({
  root, configFile: false, logLevel: 'silent',
  plugins: [what({ prodBundles: false }), reactCompat()],
  resolve: { conditions: ['browser'] },
  build: { outDir, emptyOutDir: true, modulePreload: false, rollupOptions: { input: path.join(root, 'src', 'main.jsx') } },
}));
const assets = path.join(outDir, 'assets');
const bundle = path.join(assets, fs.readdirSync(assets).find((f) => f.startsWith('main-') && f.endsWith('.js')));

const { installDOM } = await import(path.join(REPO, 'test-utils/dom.js'));
installDOM();
document.body.innerHTML = '<div id="app"></div><button id="outside">outside</button>';
const printed = [];
const { error, warn } = console;
console.error = (...args) => printed.push(`error: ${args.join(' ')}`);
console.warn = (...args) => printed.push(`warn: ${args.join(' ')}`);
try {
  await import(pathToFileURL(bundle).href);
} finally {
  console.error = error;
  console.warn = warn;
}
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

const rowsIn = (sel) => [...document.querySelectorAll(`${sel} [data-id]`)];
const find = (sel, list, id) => rowsIn(sel).find((el) => el.dataset.list === String(list) && el.dataset.id === id);
// A row's shape: list, id, count, input text, whether it is `node`.
const shape = (sel, node) => rowsIn(sel).map((el) => [el.dataset.list, el.dataset.id, el.querySelector('button').textContent, el.querySelector('input').value, el === node]);

// Click a row's count to 1 and type into it; returns its node.
async function edit(sel, list, id, text = 'edited') {
  const node = find(sel, list, id);
  node.querySelector('button').click();
  await settle();
  node.querySelector('input').value = text;
  return node;
}

async function begin(name, initial) {
  window.start('', [[], [], []]);
  await settle();
  window.start(name, initial);
  await settle();
  window.log = [];
}

test('nothing printed while the bundle loaded', () => {
  assert.deepEqual(printed, []);
});

test('three arrays in one hole: adding a key to the other two mounts fresh rows there and keeps the middle row', async () => {
  await begin('three', [[], ['a'], []]);
  const middle = await edit('#hole', 1, 'a');
  window.put([['a'], ['a'], ['a']]);
  assert.deepEqual(shape('#hole', middle), [
    ['0', 'a', '0', '0a', false],
    ['1', 'a', '1', 'edited', true],
    ['2', 'a', '0', '2a', false],
  ]);
});

test('three arrays in one hole: a key that moves to another array mounts again there (React remounts it)', async () => {
  await begin('three', [[], ['a'], []]);
  const middle = await edit('#hole', 1, 'a');
  window.put([[], [], ['a']]);
  // Unmounted before the update returns, as React's commit does.
  assert.deepEqual(window.log, ['-1a']);
  assert.deepEqual(shape('#hole', middle), [['2', 'a', '0', '2a', false]]);
  assert.equal(middle.isConnected, false);
  await settle();
  assert.deepEqual(window.log, ['-1a', '+2a']);
});

test('nested arrays: each array is its own key space', async () => {
  await begin('nested', [['a'], ['a'], []]);
  const inner = await edit('#hole', 1, 'a', 'inner');
  window.put([[], ['a'], []]);
  assert.deepEqual(shape('#hole', inner), [['1', 'a', '1', 'inner', true]]);
  window.put([['a'], [], []]);
  assert.deepEqual(shape('#hole', inner), [['0', 'a', '0', '0a', false]]);
});

test('a list and an element beside it with the same key keep their own rows', async () => {
  await begin('sibling', [[], ['x', 'a'], []]);
  const listed = await edit('#hole', 1, 'a', 'listed');
  const beside = await edit('#hole', 9, 'a', 'beside');
  window.put([[], ['x'], []]);
  assert.deepEqual(shape('#hole', beside), [['1', 'x', '0', '1x', false], ['9', 'a', '1', 'beside', true]]);
  assert.equal(listed.isConnected, false);
});

test('a fragment of two holes: each list keeps its own rows', async () => {
  await begin('frag', [['a'], ['a'], []]);
  const first = await edit('#frag', 0, 'a', 'first');
  const second = await edit('#frag', 1, 'a', 'second');
  window.put([[], ['a'], []]);
  assert.deepEqual(shape('#frag', second), [['1', 'a', '1', 'second', true]]);
  assert.equal(first.isConnected, false);
});

test('a list that empties and fills again, a microtask between: the row mounts fresh', async () => {
  await begin('flat', [[], ['a'], []]);
  const old = await edit('#hole', 1, 'a');
  window.put([[], [], []]);
  await Promise.resolve();
  window.put([[], ['a'], []]);
  assert.deepEqual(shape('#hole', old), [['1', 'a', '0', '1a', false]]);
  await settle();
  assert.deepEqual(window.log, ['-1a', '+1a']);
});

test('a list that empties and fills again in one tick: the row mounts fresh', async () => {
  await begin('flat', [[], ['a'], []]);
  const old = await edit('#hole', 1, 'a');
  window.put([[], [], []]);
  window.put([[], ['a'], []]);
  assert.deepEqual(shape('#hole', old), [['1', 'a', '0', '1a', false]]);
  await settle();
  assert.deepEqual(window.log, ['-1a', '+1a']);
});

test('rapid updates in one tick: each update is a commit of its own', async () => {
  await begin('three', [[], ['a'], []]);
  const middle = await edit('#hole', 1, 'a');
  window.put([['a'], ['a'], ['a']]);
  window.put([[], [], ['a']]);
  window.put([[], ['a'], []]);
  assert.deepEqual(shape('#hole', middle), [['1', 'a', '0', '1a', false]]);
  await settle();
  // React flushes the passive effects of a commit before the next one: the
  // rows the second update removed had run their effects.
  assert.deepEqual(window.log, ['+0a', '+2a', '-0a', '-1a', '-2a', '+1a']);
});

test('a key repeated in one array: the first element keeps its row, the others mount again', async () => {
  await begin('flat', [[], ['a', 'a'], []]);
  const [first, second] = rowsIn('#hole');
  first.querySelector('input').value = 'one';
  second.querySelector('input').value = 'two';
  window.put([[], ['a', 'a', 'b'], []]);
  const now = rowsIn('#hole');
  assert.deepEqual([now[0] === first, now[1] === second, now[2].dataset.id], [true, false, 'b']);
  assert.deepEqual([now[0].querySelector('input').value, now[1].querySelector('input').value], ['one', '1a']);
  await settle();
  // Every row mounted was cleaned up or is still there.
  window.put([[], [], []]);
  await settle();
  const mounts = window.log.filter((l) => l[0] === '+').length;
  const cleanups = window.log.filter((l) => l[0] === '-').length;
  assert.equal(mounts + 2, cleanups, window.log.join(' '));
});

test('another component type under a key: the row mounts again and the old one unmounts', async () => {
  await begin('flat', [[], ['a', 'b'], []]);
  const old = await edit('#hole', 1, 'a');
  window.retype(['a']);
  assert.deepEqual(window.log, ['-1a']);
  assert.deepEqual(shape('#hole', old).map((r) => r.slice(0, 4)), [['1', 'a', '0', '1a'], ['1', 'b', '0', '1b']]);
  assert.equal(old.isConnected, false);
});

test('a moved row keeps its focus and selection; focus taken elsewhere in the same tick stays there; a removed row is not focused', async () => {
  await begin('flat', [[], ['x', 'a', 'b'], []]);
  let input = find('#hole', 1, 'a').querySelector('input');
  input.focus();
  input.setSelectionRange(1, 2);
  window.put([[], ['b', 'a', 'x'], []]);
  assert.equal(document.activeElement, input, 'focus kept');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 2]);

  // The body (focusable) or another element focused right after the update.
  document.body.tabIndex = -1;
  window.put([[], ['x', 'a', 'b'], []]);
  document.body.focus();
  await settle();
  assert.equal(document.activeElement, document.body, 'the body keeps the focus it was given');
  document.body.removeAttribute('tabindex');
  input.focus();
  window.put([[], ['b', 'a', 'x'], []]);
  document.getElementById('outside').focus();
  await settle();
  assert.equal(document.activeElement.id, 'outside');

  // The focused row's key goes: nothing in it is focused again.
  input.focus();
  window.put([[], ['x', 'b'], []]);
  await settle();
  assert.equal(input.isConnected, false);
  assert.notEqual(document.activeElement, input);
  input = null;
});

test('unmounting the hole unmounts every row once', async () => {
  await begin('three', [['a', 'b'], ['a'], ['c']]);
  window.stop();
  await settle();
  assert.deepEqual(window.log.sort(), ['-0a', '-0b', '-1a', '-2c']);
  assert.equal(document.getElementById('app').innerHTML, '');
});
