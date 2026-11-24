// what-react: the DOM work a render does, counted. The app is the krausest
// table as a React app writes it (a memo row component, keyed rows, immutable
// updates); the numbers are what React 19.3.1 does for the same app, counted
// in Chromium on 2026-11-24 (8 elements per row, each created and inserted
// once, no comment or text node of the renderer's own). A count that grows is
// a regression: seven of these eight tests fail on 588dbede (the update of
// every tenth row already did no more), which inserted each node through a
// fragment of its own (23 inserts per row), gave each component two comment
// markers and each text a rendered node, and moved or removed three nodes
// per row.
// Run: node --test packages/react-compat/test/
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'MouseEvent', 'DocumentFragment', 'Text', 'Comment', 'CharacterData', 'Document']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { jsx } = await import('../src/jsx-runtime.js');
const { createElement: h, useState, memo, act } = React;

// ---- Counting ----

const counts = { createElement: 0, createTextNode: 0, createComment: 0, createFragment: 0, insert: 0, remove: 0, read: 0 };
function wrap(proto, name, key) {
  const original = proto[name];
  proto[name] = function (...args) { counts[key]++; return original.apply(this, args); };
}
function wrapGetter(proto, name, key) {
  const d = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, { ...d, get() { counts[key]++; return d.get.call(this); } });
}
const { Document, Node, Element, CharacterData } = dom.window;
wrap(Document.prototype, 'createElement', 'createElement');
wrap(Document.prototype, 'createElementNS', 'createElement');
wrap(Document.prototype, 'createTextNode', 'createTextNode');
wrap(Document.prototype, 'createComment', 'createComment');
wrap(Document.prototype, 'createDocumentFragment', 'createFragment');
wrap(Node.prototype, 'insertBefore', 'insert');
wrap(Node.prototype, 'appendChild', 'insert');
wrap(Node.prototype, 'removeChild', 'remove');
wrap(Element.prototype, 'remove', 'remove');
wrap(CharacterData.prototype, 'remove', 'remove');
// What the reconciler reads from the DOM to find its way.
for (const name of ['parentNode', 'nextSibling', 'firstChild']) wrapGetter(Node.prototype, name, 'read');

function counted(fn) {
  for (const k in counts) counts[k] = 0;
  act(fn);
  return { ...counts };
}

// ---- The app ----

let nextId = 1;
const build = (n) => Array.from({ length: n }, () => ({ id: nextId++, label: 'row ' + nextId }));

const Row = memo(function Row({ item, isSelected, select, remove }) {
  return jsx('tr', {
    className: isSelected ? 'danger' : '',
    children: [
      jsx('td', { className: 'col-md-1', children: item.id }),
      jsx('td', { className: 'col-md-4', children: jsx('a', { className: 'lbl', onClick: () => select(item.id), children: item.label }) }),
      jsx('td', { className: 'col-md-1', children: jsx('a', { className: 'remove', onClick: () => remove(item.id), children: jsx('span', { className: 'glyphicon', 'aria-hidden': 'true' }) }) }),
      jsx('td', { className: 'col-md-6' }),
    ],
  });
});

let api;
function App() {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState(0);
  api = { data, setData, setSelected };
  const select = React.useCallback((id) => setSelected(id), []);
  const remove = React.useCallback((id) => setData((d) => d.filter((r) => r.id !== id)), []);
  return jsx('table', {
    children: jsx('tbody', {
      children: data.map((item) => jsx(Row, { item, isSelected: selected === item.id, select, remove }, item.id)),
    }),
  });
}

const roots = [];
function mountApp(rows) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  roots.push(root);
  act(() => root.render(h(App)));
  if (rows > 0) act(() => api.setData(build(rows)));
  return container;
}
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.textContent = '';
});

const N = 100;
const rowIds = (container) => [...container.querySelectorAll('tbody tr')].map((tr) => Number(tr.firstChild.textContent));

// ---- The counts ----

test('creating rows: each element is created and inserted once, and nothing else is', () => {
  const container = mountApp(0);
  const c = counted(() => api.setData(build(N)));
  // React 19.3.1: 8 elements and 8 inserts per row.
  assert.deepEqual(c, { createElement: 8 * N, createTextNode: 0, createComment: 0, createFragment: 0, insert: 8 * N, remove: 0, read: 0 });
  const tbody = container.querySelector('tbody');
  assert.equal(tbody.childNodes.length, N);                       // rows only: a component adds no node
  assert.equal(tbody.firstChild.outerHTML,
    `<tr class=""><td class="col-md-1">${api.data[0].id}</td><td class="col-md-4"><a class="lbl">${api.data[0].label}</a></td>`
    + '<td class="col-md-1"><a class="remove"><span class="glyphicon" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>');
});

test('a list that kept its places is patched where it stands: selecting a row reads and moves nothing', () => {
  const container = mountApp(N);
  const rows = [...container.querySelectorAll('tbody tr')];
  const c = counted(() => api.setSelected(api.data[1].id));
  assert.deepEqual(c, { createElement: 0, createTextNode: 0, createComment: 0, createFragment: 0, insert: 0, remove: 0, read: 0 });
  assert.equal(rows[1].className, 'danger');
  assert.deepEqual([...container.querySelectorAll('tbody tr')], rows);
});

test('updating every tenth row writes its text and nothing else', () => {
  const container = mountApp(N);
  const texts = [...container.querySelectorAll('tbody a.lbl')].map((a) => a.firstChild);
  const c = counted(() => api.setData(api.data.map((r, i) => (i % 10 === 0 ? { id: r.id, label: r.label + ' !!!' } : r))));
  assert.equal(c.createElement + c.createTextNode + c.createComment + c.createFragment + c.insert + c.remove, 0);
  const now = [...container.querySelectorAll('tbody a.lbl')];
  assert.ok(now[0].textContent.endsWith(' !!!'));
  assert.ok(!now[1].textContent.endsWith(' !!!'));
  // The text node an element holds is kept when its text changes (React's setTextContent).
  assert.equal(now[0].firstChild, texts[0]);
});

test('appending rows inserts the new rows only, and replacing them all removes one node per row', () => {
  const container = mountApp(N);
  const first = container.querySelector('tbody tr');
  let c = counted(() => api.setData(api.data.concat(build(N))));
  assert.deepEqual({ ...c, read: 0 }, { createElement: 8 * N, createTextNode: 0, createComment: 0, createFragment: 0, insert: 8 * N, remove: 0, read: 0 });
  assert.equal(container.querySelectorAll('tbody tr').length, 2 * N);
  assert.equal(container.querySelector('tbody tr'), first);
  assert.deepEqual(rowIds(container), api.data.map((r) => r.id));

  c = counted(() => api.setData(build(N)));
  // React 19.3.1: 8 inserts per new row, 1 remove per old row.
  assert.equal(c.insert, 8 * N);
  assert.equal(c.remove, 2 * N);
  assert.equal(c.createComment + c.createTextNode + c.createFragment, 0);
  assert.deepEqual(rowIds(container), api.data.map((r) => r.id));
});

test('removing a row removes one node, and clearing removes one per row', () => {
  const container = mountApp(N);
  const rows = [...container.querySelectorAll('tbody tr')];
  let c = counted(() => api.setData(api.data.filter((_, i) => i !== 3)));
  assert.deepEqual({ ...c, read: 0 }, { createElement: 0, createTextNode: 0, createComment: 0, createFragment: 0, insert: 0, remove: 1, read: 0 });
  assert.deepEqual([...container.querySelectorAll('tbody tr')], rows.filter((_, i) => i !== 3));

  c = counted(() => api.setData([]));
  assert.equal(c.remove, N - 1);
  assert.equal(c.insert + c.createComment, 0);
  assert.equal(container.querySelector('tbody').childNodes.length, 0);
});

test('swapping two rows moves one node per row that moves, by React\'s rule', () => {
  const container = mountApp(N);
  const rows = [...container.querySelectorAll('tbody tr')];
  const swapped = api.data.slice();
  [swapped[1], swapped[N - 2]] = [swapped[N - 2], swapped[1]];
  const c = counted(() => api.setData(swapped));
  // React keeps the row that moved up where it is and moves the rows it
  // passed: N - 3 inserts (997 of 1,000 in the benchmark), no node created.
  assert.equal(c.insert, N - 3);
  assert.equal(c.createElement + c.createTextNode + c.createComment + c.createFragment + c.remove, 0);
  const expected = rows.slice();
  [expected[1], expected[N - 2]] = [expected[N - 2], expected[1]];
  assert.deepEqual([...container.querySelectorAll('tbody tr')], expected);
});

test('inserting a row in the middle places one row, in front of the rows that stay', () => {
  const container = mountApp(N);
  const rows = [...container.querySelectorAll('tbody tr')];
  const [extra] = build(1);
  const c = counted(() => api.setData([...api.data.slice(0, 5), extra, ...api.data.slice(5)]));
  assert.equal(c.insert, 8);
  assert.equal(c.remove + c.createComment + c.createTextNode + c.createFragment, 0);
  const now = [...container.querySelectorAll('tbody tr')];
  assert.equal(now.length, N + 1);
  assert.deepEqual([...now.slice(0, 5), ...now.slice(6)], rows);
  assert.deepEqual(rowIds(container), api.data.map((r) => r.id));
});

test('a component that renders nothing holds its place with one comment, and gives it up when it renders', () => {
  let show;
  function Maybe() {
    const [on, set] = useState(false);
    show = set;
    return on ? h('b', null, 'shown') : null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  roots.push(root);
  act(() => root.render(h('p', null, h('i', null, 'before'), h(Maybe), h('i', null, 'after'))));
  const p = container.firstChild;
  assert.equal(p.childNodes.length, 3);
  assert.equal(p.childNodes[1].nodeType, 8);
  act(() => show(true));
  assert.equal(p.innerHTML, '<i>before</i><b>shown</b><i>after</i>');
  act(() => show(false));
  assert.equal(p.textContent, 'beforeafter');
  assert.equal(p.childNodes.length, 3);
});
