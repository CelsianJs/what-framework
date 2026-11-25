// The order of a what-react commit in a root (createRoot), against React
// 19.3.1's: the matrix fixture's react-dom, traced by the fifth review's
// browser probe (verify-wave5 rows.jsx, packages.jsx) with the same
// components as here.
// - a class's getSnapshotBeforeUpdate reads the page before the commit
//   removes anything (a sibling that leaves is still there);
// - a root unmounted by a callback of its own commit (a removed row's
//   cleanup, a ref, an effect) is unmounted once the commit is done: the
//   commit finishes on nodes in the page, each callback returns its cleanup,
//   and every cleanup runs, before flushSync returns;
// - a row that leaves is removed before the rows that stay change;
// - a keyed move gives the focus back to the element that had it, and an
//   autoFocus that mounts with it still takes it;
// - a component its parent removes in the same batch is not rendered again.
// Run: node --test packages/react-compat/test/commit-order.test.js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'FocusEvent', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { createElement: h, useState, useLayoutEffect, useEffect, useInsertionEffect, Component, act } = React;
const { createRoot, flushSync } = ReactDOM;

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.textContent = '';
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { await tick(); act(() => {}); await tick(); };

// ---- The probe's components (rows.jsx) ----

/** @type {any[]} */
let trace = [];
let state = { l: 0, lc: 0, p: 0, pc: 0, r: 0, rc: 0, event: 0 };
let stop = () => {};
function reset() {
  trace = [];
  state = { l: 0, lc: 0, p: 0, pc: 0, r: 0, rc: 0, event: 0 };
}
const probe = () => window.dispatchEvent(new window.Event('probe-row'));
const cb = (el) => {
  if (!el) return undefined;
  state.r++;
  return () => { state.rc++; };
};
function Row({ id }) {
  useLayoutEffect(() => {
    state.l++;
    trace.push(['layout+', id, !!document.getElementById(id)]);
    return () => { state.lc++; trace.push(['layout-', id, !!document.getElementById(id)]); };
  }, []);
  useEffect(() => {
    state.p++;
    const fn = () => { state.event++; };
    window.addEventListener('probe-row', fn);
    return () => { state.pc++; window.removeEventListener('probe-row', fn); };
  }, []);
  return h('label', { id }, h('input', { ref: cb, defaultValue: id }));
}
function Delete({ tick: n, quit = false }) {
  useLayoutEffect(() => {
    trace.push(['delete setup', n]);
    return () => { trace.push(['delete cleanup', n]); if (quit) stop(); };
  }, [n]);
  return h('i', { id: 'deleted' }, 'delete');
}
class Snapshot extends Component {
  getSnapshotBeforeUpdate() { return !!document.querySelector('#deleted'); }
  componentDidUpdate(_p, _s, snapshot) { trace.push(['snapshot', snapshot]); }
  render() { return h('i', null, this.props.tick); }
}
function Retained({ tick: n }) {
  useLayoutEffect(() => {
    trace.push(['retained setup', n]);
    return () => trace.push(['retained cleanup', n]);
  }, [n]);
  return h('i', { id: 'retained' }, n);
}
// Unmounts its root from a callback of the commit that mounts it, and
// returns the cleanup of a listener it added.
function Kill({ phase }) {
  const work = () => {
    trace.push([phase, 'start']);
    const listener = () => trace.push([phase, 'leaked']);
    window.addEventListener('probe-row', listener);
    stop();
    trace.push([phase, 'returned']);
    return () => { window.removeEventListener('probe-row', listener); trace.push([phase, 'cleanup']); };
  };
  useInsertionEffect(() => (phase === 'insertion' ? work() : undefined), []);
  useLayoutEffect(() => (phase === 'layout' ? work() : undefined), []);
  useEffect(() => (phase === 'passive' ? work() : undefined), []);
  return h('b', { ref: phase === 'ref' ? (el) => (el ? work() : trace.push([phase, 'null'])) : undefined }, 'kill');
}

// A root whose list is `rows(tick)`; `put(t)` renders tick `t` in flushSync.
function scene(rows) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  let set = (/** @type {number} */ _t) => {};
  function App() {
    const [n, setN] = useState(0);
    set = setN;
    return h('main', null, rows(n));
  }
  act(() => root.render(h(App)));
  stop = () => root.unmount();
  return { container, root, put: (/** @type {number} */ t) => flushSync(() => set(t)) };
}

// ---- getSnapshotBeforeUpdate ----

test('a class\'s getSnapshotBeforeUpdate sees the sibling the commit removes (React 19.3.1: delete cleanup, snapshot true, layout+ new true)', async () => {
  const { put } = scene((n) => (n
    ? [h(Snapshot, { key: 'kept', tick: n }), h(Row, { key: 'new', id: 'new' })]
    : [h(Snapshot, { key: 'kept', tick: n }), h(Delete, { key: 'delete', tick: 0 })]));
  await settle();
  reset();
  put(1);
  assert.deepEqual(trace, [['delete cleanup', 0], ['snapshot', true], ['layout+', 'new', true]]);
  assert.deepEqual(state, { l: 1, lc: 0, p: 1, pc: 0, r: 1, rc: 0, event: 0 });
});

// ---- An unmount a commit asks for ----

test('a removed row\'s cleanup that unmounts its root: the commit finishes on nodes in the page, then the root unmounts with every cleanup, before flushSync returns (React 19.3.1)', async () => {
  const { container, root, put } = scene((n) => (n
    ? [h(Retained, { key: 'kept', tick: n }), h(Row, { key: 'new', id: 'new' })]
    : [h(Retained, { key: 'kept', tick: n }), h(Delete, { key: 'delete', tick: 0, quit: true })]));
  await settle();
  reset();
  put(1);
  assert.deepEqual(trace, [
    ['delete cleanup', 0], ['retained cleanup', 0], ['retained setup', 1], ['layout+', 'new', true],
    ['retained cleanup', 1], ['layout-', 'new', true],
  ]);
  assert.deepEqual(state, { l: 1, lc: 1, p: 1, pc: 1, r: 1, rc: 1, event: 0 });
  assert.equal(container.textContent, '');
  probe();
  await settle();
  assert.equal(state.event, 0, 'the incoming row\'s listener was removed');
  root.unmount();
  assert.deepEqual(state, { l: 1, lc: 1, p: 1, pc: 1, r: 1, rc: 1, event: 0 });
});

for (const phase of ['ref', 'insertion', 'layout', 'passive']) {
  test(`a ${phase} callback that unmounts its root returns its cleanup first, and the cleanup runs (React 19.3.1: start, returned, cleanup)`, async () => {
    const { container, put } = scene((n) => (n ? [h(Kill, { key: 'kill', phase })] : [h(Retained, { key: 'old', tick: 0 })]));
    await settle();
    reset();
    put(1);
    await settle();
    probe();
    assert.deepEqual(trace, [['retained cleanup', 0], [phase, 'start'], [phase, 'returned'], [phase, 'cleanup']]);
    assert.equal(container.textContent, '');
  });
}

// ---- Removals before what stays changes ----

test('a row that leaves is removed before the rows that stay change their refs (React 19.3.1 order)', async () => {
  const events = [];
  const note = (...x) => events.push(x.join(' '));
  function Label({ id }) {
    useLayoutEffect(() => {
      note('layout+', id, !!document.getElementById(id)?.isConnected);
      return () => note('layout-', id, !!document.getElementById(id)?.isConnected);
    }, []);
    return h('b', { id, ref: (el) => { note('ref+', id, el.isConnected); return () => note('ref-', id); } }, id);
  }
  const { put } = scene((n) => (n ? ['b', 'c'] : ['a', 'b']).map((id) => h(Label, { key: id, id: id + (id === 'b' ? n : '') })));
  await settle();
  events.length = 0;
  put(1);
  // React 19.3.1: the mutation phase removes a (layout- a, ref- a), then
  // detaches b's old ref (ref- b0); the layout phase attaches b's new one,
  // then mounts c.
  assert.deepEqual(events, ['layout- a true', 'ref- a', 'ref- b0', 'ref+ b1 true', 'ref+ c true', 'layout+ c true']);
});

// ---- Focus ----

function fields(order, extra) {
  return (n) => [
    ...(n ? order : ['a', 'b']).map((id) => h('input', { key: id, id, defaultValue: id })),
    ...(n && extra ? [h('input', { key: 'new', id: 'new', autoFocus: true })] : []),
  ];
}

test('a keyed move keeps the focus and the selection on the field that had them (React Hook Form swap(0, 1))', async () => {
  const { container, put } = scene(fields(['b', 'a'], false));
  await settle();
  const a = container.querySelector('#a');
  a.value = 'edit';
  a.focus();
  a.setSelectionRange(1, 3);
  put(1);
  assert.deepEqual([...container.querySelectorAll('input')].map((el) => el.id), ['b', 'a']);
  assert.equal(container.querySelector('#a'), a);
  assert.equal(document.activeElement, a);
  assert.equal(a.value, 'edit');
  assert.deepEqual([a.selectionStart, a.selectionEnd], [1, 3]);
});

test('an autoFocus that mounts with the move still takes the focus (React focuses it in the layout phase, after it gave the focus back)', async () => {
  const { container, put } = scene(fields(['b', 'a'], true));
  await settle();
  container.querySelector('#a').focus();
  put(1);
  assert.equal(document.activeElement, container.querySelector('#new'));
});

// ---- A component its parent removes ----

test('a component that set its state and that its parent removes in the same batch is not rendered again (React renders the tree from its root)', async () => {
  const renders = { x: 0, y: 0 };
  /** @type {Record<string, (n: number) => void>} */
  const setters = {};
  function Child({ id }) {
    const [n, set] = useState(0);
    setters[id] = set;
    renders[id]++;
    return h('span', null, id + n);
  }
  let setItems = (/** @type {string[]} */ _v) => {};
  function List() {
    const [items, set] = useState(['x', 'y']);
    setItems = set;
    return h('div', null, items.map((id) => h(Child, { key: id, id })));
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(h(List)));
  assert.deepEqual(renders, { x: 1, y: 1 });
  act(() => {
    setters.x(1);
    setItems(['y']);
  });
  assert.equal(renders.x, 1);
  assert.equal(container.textContent, 'y0');
});
