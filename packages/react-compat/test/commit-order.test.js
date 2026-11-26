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
// The sixth review's probe (verify-wave6 commit-edge.jsx), traced against
// the same React, adds (its Row and scenes, as `edge()` below):
// - a list update that throws (a memo's comparison) under an error boundary
//   or Suspense unmounts what the list showed: every cleanup runs once, and
//   a row the failed render built is never set up;
// - a controlled select takes its value once the option that held it left;
//   a class's snapshot reads a field's value as it was;
// - a root rendered from a commit's callback renders once that commit is
//   done, after its passive effects, once for every render asked for then;
// - render() on a root whose unmount waits for its commit is rejected;
// - new nodes go in left to right;
// - an unmount asked for from the first commit's ref releases everything.
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
const { createElement: h, useState, useLayoutEffect, useEffect, useInsertionEffect, Component, memo, Suspense, act } = React;
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

// ---- The sixth review's scenes (verify-wave6 commit-edge.jsx) ----
// React 19.3.1's traces are the matrix fixture's react-dom, built for
// production and run in Chromium by that probe; each scene here runs the
// probe's own steps, and compares the whole trace.

/**
 * The probe's Row and its run: `body(ctx)` renders and updates; then, as the
 * probe does, a turn, the listener event, root.unmount(), a turn and the
 * event again. Returns the trace and the container's text at the end.
 * @param {(ctx: any) => Promise<void> | void} body
 */
async function edge(body) {
  /** @type {any[]} */
  const events = [];
  const note = (...v) => events.push(v);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const put = (/** @type {any} */ el) => flushSync(() => root.render(el));
  const ref = (/** @type {any} */ el) => {
    if (el) { note('ref+', el.id, el.isConnected); return () => note('ref-', el.id, el.isConnected); }
    note('null');
    return undefined;
  };
  function Row({ id, quit }) {
    note('render', id, 0);
    useLayoutEffect(() => {
      const el = document.getElementById(id);
      note('layout+', id, !!el?.isConnected);
      return () => {
        note('layout-', id, !!el?.isConnected);
        if (quit) quit();
      };
    }, []);
    useEffect(() => {
      const listener = () => note('listener', id);
      window.addEventListener('wave6', listener);
      note('passive+', id, !!document.getElementById(id)?.isConnected);
      return () => {
        note('passive-', id);
        window.removeEventListener('wave6', listener);
      };
    }, []);
    return h('span', { id, ref }, id + 0);
  }
  const ctx = { events, note, container, root, put, Row, tree: (/** @type {any[]} */ ...kids) => h('main', null, ...kids), extra: () => {} };
  await body(ctx);
  await settle();
  window.dispatchEvent(new window.Event('wave6'));
  root.unmount();
  await settle();
  window.dispatchEvent(new window.Event('wave6'));
  ctx.extra();
  container.remove();
  return { events, end: container.innerHTML };
}

class Boundary extends Component {
  constructor(props) { super(props); this.state = { bad: false }; }
  static getDerivedStateFromError() { return { bad: true }; }
  render() { return this.state.bad ? h('b', { id: 'fallback' }, 'fallback') : this.props.children; }
}

/** A list whose kept memo row's comparison throws `thrown` on the update; `fresh` comes before or after it. */
function throwingList(ctx, thrown, freshFirst) {
  const Kept = memo(function Kept({ n }) { return h('b', null, n); }, () => { throw thrown; });
  let change = (/** @type {number} */ _n) => {};
  function List() {
    const [n, set] = useState(0);
    change = set;
    if (!n) return [h(ctx.Row, { key: 'deleted', id: 'deleted' }), h(Kept, { key: 'kept', n })];
    return freshFirst
      ? [h(ctx.Row, { key: 'fresh', id: 'fresh' }), h(Kept, { key: 'kept', n })]
      : [h(Kept, { key: 'kept', n }), h(ctx.Row, { key: 'fresh', id: 'fresh' })];
  }
  return { List, update: () => flushSync(() => change(1)) };
}

const quietly = async (/** @type {() => any} */ fn) => {
  const { error } = console;
  console.error = () => {};
  try { return await fn(); } finally { console.error = error; }
};

test('a list update whose memo comparison throws, caught by an error boundary, unmounts the row it removed: ref, layout and passive cleanups, no listener left (React 19.3.1 boundary-memo)', async () => {
  const { events, end } = await quietly(() => edge(async (ctx) => {
    const { List, update } = throwingList(ctx, new Error('memo comparison failed'), false);
    ctx.put(h(Boundary, null, h(List)));
    await settle();
    ctx.events.length = 0;
    update();
    assert.equal(ctx.container.innerHTML, '<b id="fallback">fallback</b>');
  }));
  assert.deepEqual(events, [['layout-', 'deleted', true], ['ref-', 'deleted', true], ['passive-', 'deleted']]);
  assert.equal(end, '');
});

test('a row the failed list render built before the memo threw is never set up (React 19.3.1: rendered, not committed)', async () => {
  const { events } = await quietly(() => edge(async (ctx) => {
    const { List, update } = throwingList(ctx, new Error('memo comparison failed'), true);
    ctx.put(h(Boundary, null, h('main', null, h(List))));
    await settle();
    ctx.events.length = 0;
    update();
  }));
  // React renders `fresh` (twice: it retries the render) and commits none of it.
  assert.deepEqual(events.filter((e) => e[0] !== 'render'), [['layout-', 'deleted', true], ['ref-', 'deleted', true], ['passive-', 'deleted']]);
});

test('a memo comparison that suspends under Suspense: the removed row is cleaned up once and its listener is gone after unmount (React 19.3.1 suspense-memo keeps it hidden, its listener until the unmount)', async () => {
  const { events, end } = await edge(async (ctx) => {
    const { List, update } = throwingList(ctx, new Promise(() => {}), false);
    ctx.put(h(Suspense, { fallback: h('b', { id: 'fallback' }, 'fallback') }, h(List)));
    await settle();
    ctx.events.length = 0;
    update();
    await settle();
    assert.match(ctx.container.innerHTML, /<b id="fallback">fallback<\/b>$/);
  });
  // React: layout- deleted, ref- deleted, the hidden row's listener, then
  // passive- deleted at the unmount. what-react unmounts what the list
  // showed (MIXED.md): all three cleanups, once.
  assert.deepEqual(events.filter((e) => e[0] !== 'render'), [['layout-', 'deleted', true], ['ref-', 'deleted', true], ['passive-', 'deleted']]);
  assert.equal(end, '');
});

test('a controlled select takes its value from the option that arrives, once the option that held it left (React 19.3.1 select-removed: new selected)', async () => {
  await edge((ctx) => {
    const view = (/** @type {number} */ n) => h('select', { value: 'x', onChange: () => {} }, n
      ? [h('option', { key: 'y', value: 'y' }, 'y'), h('option', { key: 'new', value: 'x' }, 'new')]
      : [h('option', { key: 'old', value: 'x' }, 'old'), h('option', { key: 'y', value: 'y' }, 'y')]);
    ctx.put(view(0));
    ctx.put(view(1));
    const select = ctx.container.querySelector('select');
    assert.deepEqual([...select.options].map((el) => [el.textContent, el.selected]), [['y', false], ['new', true]]);
    assert.equal(select.value, 'x');
  });
});

test('a class\'s getSnapshotBeforeUpdate reads a field\'s value before the commit writes it (React 19.3.1: snapshot a a, did update b)', async () => {
  const { events } = await edge((ctx) => {
    class Snap extends Component {
      getSnapshotBeforeUpdate() { ctx.note('snapshot', document.getElementById('field').value, document.getElementById('opt').value); return null; }
      componentDidUpdate() { ctx.note('did update', document.getElementById('field').value); }
      render() { return h('i', null, this.props.v); }
    }
    const view = (/** @type {string} */ v) => ctx.tree(h('input', { id: 'field', value: v, onChange() {} }), h('option', { id: 'opt', value: v }), h(Snap, { v }));
    ctx.put(view('a'));
    ctx.put(view('b'));
  });
  assert.deepEqual(events, [['snapshot', 'a', 'a'], ['did update', 'b']]);
});

for (const stopToo of [false, true]) {
  test(`another root rendered from a removed row's layout cleanup${stopToo ? ', which also unmounts its own root,' : ''} renders once the commit is done: the incoming row's ref and layout effect first, then its passive effect (React 19.3.1 ${stopToo ? 'nested-render-stop' : 'nested-render'})`, async () => {
    let other = '';
    const { events } = await edge(async (ctx) => {
      const otherHost = document.body.appendChild(document.createElement('div'));
      const otherRoot = createRoot(otherHost);
      flushSync(() => otherRoot.render(h('i', null, 0)));
      const quit = () => {
        if (stopToo) ctx.root.unmount();
        ctx.note('before nested render');
        otherRoot.render(h('i', null, 1));
        ctx.note('after nested render', otherHost.textContent);
      };
      ctx.put(ctx.tree(h(ctx.Row, { id: 'deleted', key: 'd', quit }), h(ctx.Row, { id: 'a', key: 'a' })));
      await settle();
      ctx.events.length = 0;
      ctx.put(ctx.tree(h(ctx.Row, { id: 'a', key: 'a' }), h(ctx.Row, { id: 'fresh', key: 'f' })));
      other = otherHost.textContent;
      otherRoot.unmount();
      otherHost.remove();
    });
    assert.equal(other, '1');
    const commit = [
      ['render', 'a', 0], ['render', 'fresh', 0], ['layout-', 'deleted', true], ['before nested render'], ['after nested render', '0'],
      ['ref-', 'deleted', true], ['ref+', 'fresh', true], ['layout+', 'fresh', true], ['passive-', 'deleted'], ['passive+', 'fresh', true],
    ];
    const teardown = [['layout-', 'a', true], ['ref-', 'a', true], ['layout-', 'fresh', true], ['ref-', 'fresh', true], ['passive-', 'a'], ['passive-', 'fresh']];
    assert.deepEqual(events, stopToo ? [...commit, ...teardown] : [...commit, ['listener', 'a'], ['listener', 'fresh'], ...teardown]);
  });
}

test('the renders a commit\'s cleanup asks of another root are one: a callback ref the last one gives attaches once and is cleaned up once (React 19.3.1 ref-coalesce)', async () => {
  let number = 0;
  const { events } = await edge(async (ctx) => {
    const otherHost = document.body.appendChild(document.createElement('div'));
    const other = createRoot(otherHost);
    const obj = { current: null };
    const callback = (/** @type {any} */ el) => {
      if (!el) { ctx.note('callback null'); return undefined; }
      const id = ++number;
      const listener = () => ctx.note('coalesce listener', id);
      window.addEventListener('wave6', listener);
      ctx.note('callback+', id, el.isConnected);
      return () => { window.removeEventListener('wave6', listener); ctx.note('callback-', id, el.isConnected); };
    };
    const view = (/** @type {any} */ r) => h('input', { id: 'other-input', ref: r });
    flushSync(() => other.render(view(obj)));
    const quit = () => {
      other.render(view(callback));
      other.render(view(obj));
      other.render(view(callback));
    };
    ctx.put(ctx.tree(h(ctx.Row, { id: 'deleted', key: 'd', quit })));
    await settle();
    ctx.events.length = 0;
    ctx.put(ctx.tree(h('i', { key: 'replacement' }, 'replacement')));
    ctx.note('object', obj.current?.id ?? null);
    other.unmount();
    otherHost.remove();
  });
  assert.deepEqual(events, [
    ['layout-', 'deleted', true], ['ref-', 'deleted', true], ['passive-', 'deleted'],
    ['callback+', 1, true], ['object', null], ['callback-', 1, true],
  ]);
});

test('render() on a root whose unmount waits for the commit is rejected, and the commit finishes before the unmount (React 19.3.1 pending-render: error #409)', async () => {
  let afterFlush = '';
  const { events } = await edge(async (ctx) => {
    const quit = () => {
      ctx.root.unmount();
      try { ctx.root.render(h(ctx.Row, { id: 'replacement' })); ctx.note('render returned'); } catch (e) { ctx.note('render rejected', /** @type {Error} */ (e).message); }
    };
    ctx.put(ctx.tree(h(ctx.Row, { id: 'deleted', key: 'deleted', quit })));
    await settle();
    ctx.events.length = 0;
    ctx.put(ctx.tree(h(ctx.Row, { id: 'fresh', key: 'fresh' })));
    afterFlush = ctx.container.textContent;
  });
  assert.equal(afterFlush, '');
  assert.deepEqual(events, [
    ['render', 'fresh', 0], ['layout-', 'deleted', true], ['render rejected', 'Cannot update an unmounted root.'],
    ['ref-', 'deleted', true], ['ref+', 'fresh', true], ['layout+', 'fresh', true], ['passive-', 'deleted'], ['passive+', 'fresh', true],
    ['layout-', 'fresh', true], ['ref-', 'fresh', true], ['passive-', 'fresh'],
  ]);
});

test('render() after unmount() is rejected outside a commit too, and a second unmount() does nothing (React 19.3.1: error #409)', () => {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  flushSync(() => root.render(h('b', null, 'x')));
  root.unmount();
  assert.throws(() => root.render(h('b', null, 'y')), { message: 'Cannot update an unmounted root.' });
  root.unmount();
  assert.equal(container.innerHTML, '');
  container.remove();
});

test('an unmount asked for by a ref of the first commit runs once the commit is done, with everything it mounted (React 19.3.1 mount-ref-stop)', async () => {
  const { events } = await edge(async (ctx) => {
    const quit = () => {
      ctx.note('before unmount', ctx.container.textContent);
      ctx.root.unmount();
      ctx.note('after unmount', ctx.container.textContent);
    };
    function Kill() {
      useEffect(() => () => ctx.note('kill passive cleanup'), []);
      return h('i', { id: 'kill', ref: (/** @type {any} */ el) => {
        if (!el) { ctx.note('kill ref null'); return undefined; }
        quit();
        ctx.note('returned');
        return () => ctx.note('kill ref cleanup', el.isConnected);
      } }, 'kill');
    }
    ctx.put(ctx.tree(h(Kill), h(ctx.Row, { id: 'fresh' })));
    assert.equal(ctx.container.textContent, '');
  });
  assert.deepEqual(events, [
    ['render', 'fresh', 0], ['before unmount', 'killfresh0'], ['after unmount', 'killfresh0'], ['returned'],
    ['ref+', 'fresh', true], ['layout+', 'fresh', true], ['passive+', 'fresh', true],
    ['kill ref cleanup', true], ['layout-', 'fresh', true], ['ref-', 'fresh', true], ['kill passive cleanup'], ['passive-', 'fresh'],
  ]);
});

test('new nodes before an end that stayed go in left to right: each custom element\'s connectedCallback sees the ones before it (React 19.3.1 insert-before-tail)', async () => {
  const { events } = await edge((ctx) => {
    window.customElements.define('x-lane-row', class extends window.HTMLElement {
      connectedCallback() { ctx.note('connected', this.id, [...this.parentNode.children].map((e) => e.id)); }
    });
    const row = (/** @type {string} */ id) => h('x-lane-row', { id, key: id });
    ctx.put(ctx.tree(row('tail')));
    ctx.events.length = 0;
    ctx.put(ctx.tree(row('first'), row('second'), row('tail')));
  });
  assert.deepEqual(events, [['connected', 'first', ['first', 'tail']], ['connected', 'second', ['first', 'second', 'tail']]]);
});
