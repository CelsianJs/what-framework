// what-react compat runtime — React hook/render semantics tests (jsdom).
// Run: node --test packages/react-compat/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch (e) { /* read-only global */ }
}
try { global.navigator = dom.window.navigator; } catch (e) { /* Node ≥21 read-only getter */ }
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const {
  createElement: h, useState, useEffect, useLayoutEffect, useMemo, useCallback,
  useRef, useReducer, useContext, createContext, useSyncExternalStore, useId,
  memo, lazy, Suspense, Component, act, Fragment,
} = React;
const { createRoot, createPortal, flushSync } = ReactDOM;

function makeContainer() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function mount(element) {
  const container = makeContainer();
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------

test('renders host elements with props and text children', () => {
  const { container } = mount(
    h('div', { className: 'box', id: 'a' }, h('span', null, 'hello'), ' world', 42),
  );
  const div = container.querySelector('#a');
  assert.ok(div);
  assert.equal(div.className, 'box');
  assert.equal(div.textContent, 'hello world42');
});

test('useState returns a VALUE, not an accessor', () => {
  let seen;
  function App() {
    const [count] = useState(5);
    seen = count;
    return h('div', null, count * 2);
  }
  const { container } = mount(h(App));
  assert.equal(seen, 5);
  assert.equal(container.textContent, '10');
});

test('setState re-renders with the new value', async () => {
  let setCount;
  function Counter() {
    const [count, set] = useState(0);
    setCount = set;
    return h('div', null, 'count:', count);
  }
  const { container } = mount(h(Counter));
  assert.equal(container.textContent, 'count:0');
  act(() => setCount(1));
  assert.equal(container.textContent, 'count:1');
  act(() => setCount((c) => c + 10));
  assert.equal(container.textContent, 'count:11');
});

test('multiple setState calls in one handler batch into one render', () => {
  let renders = 0;
  let bump;
  function App() {
    renders++;
    const [count, set] = useState(0);
    bump = () => { set((c) => c + 1); set((c) => c + 1); set((c) => c + 1); };
    return h('div', null, count);
  }
  const { container } = mount(h(App));
  assert.equal(renders, 1);
  act(() => bump());
  assert.equal(container.textContent, '3');
  assert.equal(renders, 2);
});

test('setState with identical value does not re-render', () => {
  let renders = 0;
  let set;
  function App() {
    renders++;
    const [v, s] = useState('a');
    set = s;
    return h('div', null, v);
  }
  mount(h(App));
  act(() => set('a'));
  assert.equal(renders, 1);
});

test('DOM elements are PRESERVED across re-renders (reconciliation, not blow-away)', () => {
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    return h('div', null, h('input', { id: 'keep' }), h('span', null, n));
  }
  const { container } = mount(h(App));
  const input = container.querySelector('#keep');
  input.value = 'typed';
  act(() => set(1));
  assert.equal(container.querySelector('#keep'), input, 'same input node');
  assert.equal(input.value, 'typed', 'input state preserved');
  assert.equal(container.querySelector('span').textContent, '1');
});

test('child component hook state survives parent re-render', () => {
  let setParent, setChild;
  function Child() {
    const [v, s] = useState('child-0');
    setChild = s;
    return h('em', null, v);
  }
  function Parent() {
    const [n, s] = useState(0);
    setParent = s;
    return h('div', null, h('b', null, n), h(Child));
  }
  const { container } = mount(h(Parent));
  act(() => setChild('child-1'));
  assert.equal(container.querySelector('em').textContent, 'child-1');
  act(() => setParent(99));
  assert.equal(container.querySelector('b').textContent, '99');
  assert.equal(container.querySelector('em').textContent, 'child-1', 'child state preserved');
});

test('conditional children keep sibling slots stable (holes)', () => {
  let set;
  function App() {
    const [show, s] = useState(false);
    set = s;
    return h('div', null, show && h('p', null, 'banner'), h('input', { id: 'field' }));
  }
  const { container } = mount(h(App));
  const input = container.querySelector('#field');
  act(() => set(true));
  assert.ok(container.querySelector('p'));
  assert.equal(container.querySelector('#field'), input, 'input not remounted when sibling toggles');
  assert.equal(container.querySelector('div').firstElementChild.tagName, 'P', 'banner inserted before input');
  act(() => set(false));
  assert.equal(container.querySelector('p'), null);
  assert.equal(container.querySelector('#field'), input);
});

test('keyed list reorder moves DOM nodes instead of recreating', () => {
  let set;
  function App() {
    const [items, s] = useState(['a', 'b', 'c']);
    set = s;
    return h('ul', null, items.map((it) => h('li', { key: it }, it)));
  }
  const { container } = mount(h(App));
  const [liA, liB, liC] = container.querySelectorAll('li');
  act(() => set(['c', 'a', 'b']));
  const after = [...container.querySelectorAll('li')];
  assert.deepEqual(after.map((li) => li.textContent), ['c', 'a', 'b']);
  assert.equal(after[0], liC);
  assert.equal(after[1], liA);
  assert.equal(after[2], liB);
});

test('keyed component children preserve state across reorder', () => {
  const setters = {};
  function Item({ id }) {
    const [v, s] = useState(`${id}-init`);
    setters[id] = s;
    return h('li', null, v);
  }
  let setOrder;
  function App() {
    const [order, s] = useState(['x', 'y']);
    setOrder = s;
    return h('ul', null, order.map((id) => h(Item, { key: id, id })));
  }
  const { container } = mount(h(App));
  act(() => setters.x('x-changed'));
  act(() => setOrder(['y', 'x']));
  const lis = [...container.querySelectorAll('li')];
  assert.deepEqual(lis.map((li) => li.textContent), ['y-init', 'x-changed']);
});

// ---------------------------------------------------------------
// useReducer / useMemo / useCallback / useRef / useId
// ---------------------------------------------------------------

test('useReducer returns state VALUE and working dispatch', () => {
  let dispatch;
  function App() {
    const [state, d] = useReducer((s, a) => (a.type === 'inc' ? { n: s.n + 1 } : s), { n: 0 });
    dispatch = d;
    return h('div', null, state.n);
  }
  const { container } = mount(h(App));
  assert.equal(container.textContent, '0');
  act(() => dispatch({ type: 'inc' }));
  act(() => dispatch({ type: 'inc' }));
  assert.equal(container.textContent, '2');
});

test('useMemo returns the VALUE and honors deps', () => {
  let computes = 0;
  let setA, setB;
  let memoVal;
  function App() {
    const [a, sa] = useState(1);
    const [b, sb] = useState(0);
    setA = sa; setB = sb;
    memoVal = useMemo(() => { computes++; return a * 10; }, [a]);
    return h('div', null, memoVal + b);
  }
  mount(h(App));
  assert.equal(memoVal, 10);
  assert.equal(computes, 1);
  act(() => setB(5));
  assert.equal(computes, 1, 'no recompute when other state changes');
  act(() => setA(2));
  assert.equal(memoVal, 20);
  assert.equal(computes, 2);
});

test('useCallback is stable for same deps, new for changed deps', () => {
  let setA, setB;
  const refs = [];
  function App() {
    const [a, sa] = useState(0);
    const [, sb] = useState(0);
    setA = sa; setB = sb;
    refs.push(useCallback(() => a, [a]));
    return null;
  }
  mount(h(App));
  act(() => setB(1));
  assert.equal(refs[0], refs[1], 'stable when deps unchanged');
  act(() => setA(1));
  assert.notEqual(refs[1], refs[2], 'new callback when deps change');
});

test('useRef persists across renders and never triggers re-render', () => {
  let set;
  const seen = [];
  function App() {
    const [n, s] = useState(0);
    set = s;
    const ref = useRef(0);
    ref.current++;
    seen.push(ref);
    return h('div', null, n);
  }
  mount(h(App));
  act(() => set(1));
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1].current, 2);
});

test('useId is stable across re-renders and unique per component', () => {
  let set;
  const ids = [];
  function App() {
    const [, s] = useState(0);
    set = s;
    ids.push(useId(), useId());
    return null;
  }
  mount(h(App));
  act(() => set(1));
  assert.equal(ids[0], ids[2]);
  assert.equal(ids[1], ids[3]);
  assert.notEqual(ids[0], ids[1]);
});

// ---------------------------------------------------------------
// Effects
// ---------------------------------------------------------------

test('useEffect runs after mount, honors deps, cleans up on change + unmount', async () => {
  const log = [];
  let set;
  function App({ tag }) {
    const [dep, s] = useState(0);
    set = s;
    useEffect(() => {
      log.push(`run:${dep}`);
      return () => log.push(`clean:${dep}`);
    }, [dep]);
    useEffect(() => { log.push('mount-only'); }, []);
    return h('div', null, dep);
  }
  const { root } = mount(h(App));
  await tick();
  assert.deepEqual(log, ['run:0', 'mount-only']);
  act(() => set(1));
  await tick();
  assert.deepEqual(log, ['run:0', 'mount-only', 'clean:0', 'run:1']);
  act(() => root.unmount());
  assert.deepEqual(log, ['run:0', 'mount-only', 'clean:0', 'run:1', 'clean:1']);
});

test('effects run child-first (React ordering)', async () => {
  const order = [];
  function Child() {
    useEffect(() => { order.push('child'); }, []);
    return null;
  }
  function Parent() {
    useEffect(() => { order.push('parent'); }, []);
    return h(Child);
  }
  mount(h(Parent));
  await tick();
  assert.deepEqual(order, ['child', 'parent']);
});

test('useLayoutEffect runs synchronously after commit, before passive effects', async () => {
  const order = [];
  function App() {
    useEffect(() => { order.push('passive'); }, []);
    useLayoutEffect(() => { order.push('layout'); }, []);
    return h('div', { id: 'le' }, 'x');
  }
  const container = makeContainer();
  const root = createRoot(container);
  root.render(h(App));
  // layout effect already ran synchronously; DOM was committed first
  assert.deepEqual(order, ['layout']);
  assert.ok(container.querySelector('#le'));
  await tick();
  assert.deepEqual(order, ['layout', 'passive']);
});

test('no-deps useEffect re-runs every render', async () => {
  let runs = 0;
  let set;
  function App() {
    const [, s] = useState(0);
    set = s;
    useEffect(() => { runs++; });
    return null;
  }
  mount(h(App));
  await tick();
  assert.equal(runs, 1);
  act(() => set(1));
  await tick();
  assert.equal(runs, 2);
});

// ---------------------------------------------------------------
// Context
// ---------------------------------------------------------------

test('useContext reads default value with no provider', () => {
  const Ctx = createContext('fallback');
  let seen;
  function App() {
    seen = useContext(Ctx);
    return null;
  }
  mount(h(App));
  assert.equal(seen, 'fallback');
});

test('Provider value reaches a DIRECT child (audit regression)', () => {
  const Ctx = createContext('default');
  let seen;
  function Child() {
    seen = useContext(Ctx);
    return h('div', null, seen);
  }
  const { container } = mount(h(Ctx.Provider, { value: 'provided' }, h(Child)));
  assert.equal(seen, 'provided');
  assert.equal(container.textContent, 'provided');
});

test('Provider value reaches deeply nested children through elements + components', () => {
  const Ctx = createContext(null);
  let seen;
  function Leaf() {
    seen = useContext(Ctx);
    return h('i', null, String(seen));
  }
  function Middle() {
    return h('section', null, h('div', null, h(Leaf)));
  }
  mount(h(Ctx.Provider, { value: 42 }, h('main', null, h(Middle))));
  assert.equal(seen, 42);
});

test('context value updates re-render consumers', () => {
  const Ctx = createContext(0);
  let setVal;
  function Consumer() {
    const v = useContext(Ctx);
    return h('output', null, v);
  }
  function App() {
    const [v, s] = useState(1);
    setVal = s;
    return h(Ctx.Provider, { value: v }, h(Consumer));
  }
  const { container } = mount(h(App));
  assert.equal(container.querySelector('output').textContent, '1');
  act(() => setVal(2));
  assert.equal(container.querySelector('output').textContent, '2');
});

test('context propagates through memo-bailed intermediate components', () => {
  const Ctx = createContext(0);
  let middleRenders = 0;
  let setVal;
  function Leaf() {
    const v = useContext(Ctx);
    return h('output', null, v);
  }
  const Middle = memo(function Middle() {
    middleRenders++;
    return h('div', null, h(Leaf));
  });
  function App() {
    const [v, s] = useState(1);
    setVal = s;
    return h(Ctx.Provider, { value: v }, h(Middle, { static: true }));
  }
  const { container } = mount(h(App));
  assert.equal(middleRenders, 1);
  act(() => setVal(7));
  assert.equal(middleRenders, 1, 'memo middle did not re-render');
  assert.equal(container.querySelector('output').textContent, '7', 'leaf still got new context value');
});

test('nested providers: nearest wins, siblings isolated', () => {
  const Ctx = createContext('root');
  const seen = {};
  function Probe({ name }) {
    seen[name] = useContext(Ctx);
    return null;
  }
  mount(h(Ctx.Provider, { value: 'outer' },
    h(Probe, { name: 'a' }),
    h(Ctx.Provider, { value: 'inner' }, h(Probe, { name: 'b' })),
    h(Probe, { name: 'c' }),
  ));
  assert.equal(seen.a, 'outer');
  assert.equal(seen.b, 'inner');
  assert.equal(seen.c, 'outer');
});

test('Context.Consumer render-prop works', () => {
  const Ctx = createContext('x');
  const { container } = mount(
    h(Ctx.Provider, { value: 'consumed' },
      h(Ctx.Consumer, null, (v) => h('div', null, v))),
  );
  assert.equal(container.textContent, 'consumed');
});

// ---------------------------------------------------------------
// useSyncExternalStore
// ---------------------------------------------------------------

function makeStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) { state = next; listeners.forEach((l) => l()); },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    listenerCount: () => listeners.size,
  };
}

test('useSyncExternalStore returns snapshot VALUE and re-renders on change', async () => {
  const store = makeStore({ count: 1 });
  function App() {
    const snap = useSyncExternalStore(store.subscribe, store.get);
    return h('div', null, snap.count * 2);
  }
  const { container } = mount(h(App));
  assert.equal(container.textContent, '2');
  act(() => store.set({ count: 5 }));
  assert.equal(container.textContent, '10');
});

test('useSyncExternalStore unsubscribes on unmount', async () => {
  const store = makeStore(0);
  function App() {
    useSyncExternalStore(store.subscribe, store.get);
    return null;
  }
  const { root } = mount(h(App));
  await tick();
  assert.equal(store.listenerCount(), 1);
  act(() => root.unmount());
  assert.equal(store.listenerCount(), 0);
});

test('use-sync-external-store-with-selector shim works (B2)', async () => {
  const { useSyncExternalStoreWithSelector } = await import('../src/use-sync-external-store-with-selector.js');
  const store = makeStore({ a: 1, b: 'keep' });
  let renders = 0;
  function App() {
    renders++;
    const a = useSyncExternalStoreWithSelector(
      store.subscribe, store.get, undefined, (s) => s.a, Object.is,
    );
    return h('div', null, a);
  }
  const { container } = mount(h(App));
  assert.equal(container.textContent, '1');
  act(() => store.set({ a: 2, b: 'keep' }));
  assert.equal(container.textContent, '2');
  const before = renders;
  act(() => store.set({ a: 2, b: 'changed' }));
  assert.equal(renders, before, 'no re-render when selected slice is equal');
});

// ---------------------------------------------------------------
// memo / class components / error boundary / lazy+Suspense / portal
// ---------------------------------------------------------------

test('memo skips re-render when props are shallow-equal', () => {
  let childRenders = 0;
  const Child = memo(function Child({ label }) {
    childRenders++;
    return h('div', null, label);
  });
  let set;
  function App() {
    const [, s] = useState(0);
    set = s;
    return h(Child, { label: 'static' });
  }
  mount(h(App));
  assert.equal(childRenders, 1);
  act(() => set(1));
  assert.equal(childRenders, 1);
});

test('class components: setState re-renders, lifecycle methods fire', async () => {
  const log = [];
  let instance;
  class Counter extends Component {
    constructor(props) {
      super(props);
      this.state = { n: 0 };
      instance = this;
    }
    componentDidMount() { log.push('mount'); }
    componentWillUnmount() { log.push('unmount'); }
    render() {
      return h('div', null, 'n=', this.state.n);
    }
  }
  const { container, root } = mount(h(Counter));
  await tick();
  assert.equal(container.textContent, 'n=0');
  assert.deepEqual(log, ['mount']);
  act(() => instance.setState({ n: 3 }));
  assert.equal(container.textContent, 'n=3');
  act(() => root.unmount());
  assert.deepEqual(log, ['mount', 'unmount']);
});

test('class error boundary catches child render error', () => {
  class Boundary extends Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    render() {
      return this.state.error
        ? h('div', { id: 'fallback' }, 'caught: ' + this.state.error.message)
        : this.props.children;
    }
  }
  function Bomb() {
    throw new Error('boom');
  }
  const { container } = mount(h(Boundary, null, h(Bomb)));
  assert.equal(container.querySelector('#fallback').textContent, 'caught: boom');
});

test('lazy + Suspense: fallback then resolved component', async () => {
  let resolveLoader;
  const LazyComp = lazy(() => new Promise((res) => {
    resolveLoader = () => res({ default: () => h('div', { id: 'loaded' }, 'ready') });
  }));
  const { container } = mount(
    h(Suspense, { fallback: h('div', { id: 'spinner' }, 'loading…') }, h(LazyComp)),
  );
  await tick();
  assert.ok(container.querySelector('#spinner'), 'fallback shown while pending');
  resolveLoader();
  await tick();
  await tick();
  assert.ok(container.querySelector('#loaded'), 'lazy component rendered after resolve');
  assert.equal(container.querySelector('#spinner'), null);
});

test('createPortal renders children into the target container', () => {
  const target = makeContainer();
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    return h('div', null, 'main', createPortal(h('p', { id: 'ported' }, 'portal:', n), target));
  }
  const { container, root } = mount(h(App));
  assert.equal(container.textContent.includes('portal'), false);
  assert.equal(target.querySelector('#ported').textContent, 'portal:0');
  act(() => set(1));
  assert.equal(target.querySelector('#ported').textContent, 'portal:1');
  act(() => root.unmount());
  assert.equal(target.querySelector('#ported'), null, 'portal content removed on unmount');
});

// ---------------------------------------------------------------
// Events & controlled inputs
// ---------------------------------------------------------------

test('onClick handlers fire and update state', () => {
  function App() {
    const [n, set] = useState(0);
    return h('button', { onClick: () => set((c) => c + 1) }, n);
  }
  const { container } = mount(h(App));
  const btn = container.querySelector('button');
  act(() => btn.click());
  act(() => btn.click());
  assert.equal(btn.textContent, '2');
});

test('onChange on text input fires per input event (React semantics)', () => {
  const values = [];
  function App() {
    const [v, set] = useState('');
    return h('input', { value: v, onChange: (e) => { values.push(e.target.value); set(e.target.value); } });
  }
  const { container } = mount(h(App));
  const input = container.querySelector('input');
  input.value = 'a';
  act(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
  input.value = 'ab';
  act(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
  assert.deepEqual(values, ['a', 'ab']);
  assert.equal(input.value, 'ab');
});

test('checkbox onChange uses native change event', () => {
  let checked = null;
  function App() {
    return h('input', { type: 'checkbox', onChange: (e) => { checked = e.target.checked; } });
  }
  const { container } = mount(h(App));
  const box = container.querySelector('input');
  act(() => box.click());
  assert.equal(checked, true);
});

test('element refs: callback + object, attach and detach', () => {
  const objRef = React.createRef();
  const calls = [];
  let set;
  function App() {
    const [show, s] = useState(true);
    set = s;
    return show ? h('div', { ref: objRef }, h('span', { ref: (el) => calls.push(el && el.tagName) })) : null;
  }
  mount(h(App));
  assert.equal(objRef.current.tagName, 'DIV');
  assert.deepEqual(calls, ['SPAN']);
  act(() => set(false));
  assert.equal(objRef.current, null);
  assert.deepEqual(calls, ['SPAN', null]);
});

test('style objects get px for numbers, unitless props stay raw', () => {
  const { container } = mount(h('div', { style: { width: 10, zIndex: 3, opacity: 0.5 } }));
  const el = container.firstChild;
  assert.equal(el.style.width, '10px');
  assert.equal(el.style.zIndex, '3');
  assert.equal(el.style.opacity, '0.5');
});

// ---------------------------------------------------------------
// Loop guard
// ---------------------------------------------------------------

test('infinite re-render loop is guarded, does not hang', async () => {
  const origError = console.error;
  const errors = [];
  console.error = (...a) => errors.push(a.join(' '));
  try {
    function Evil() {
      const [n, set] = useState(0);
      useEffect(() => { set((c) => c + 1); }); // no deps → every render → loop
      return h('div', null, n);
    }
    mount(h(Evil));
    for (let i = 0; i < 30; i++) await tick();
    assert.ok(errors.some((e) => e.includes('what-react')), 'loop guard reported');
  } finally {
    console.error = origError;
  }
});

// ---------------------------------------------------------------
// Interop with native What components
// ---------------------------------------------------------------

test('native What component (run-once + signals) works inside a compat tree', async () => {
  const { h: whatH, signal } = await import('what-core');
  const count = signal(0, 'interopCount');
  function WhatCounter() {
    return whatH('div', { id: 'what-native' }, () => `signal:${count()}`);
  }
  function App() {
    const [n, set] = useState(0);
    return h('div', null,
      h('button', { onClick: () => set(n + 1) }, 'compat:', n),
      whatH(WhatCounter, {}),
    );
  }
  const { container } = mount(h(App));
  assert.ok(container.textContent.includes('signal:0'));
  count.set(5);
  await tick();
  assert.ok(container.textContent.includes('signal:5'), 'signal updates flow in opaque subtree');
  const native = container.querySelector('#what-native');
  act(() => container.querySelector('button').click());
  assert.ok(container.textContent.includes('compat:1'));
  assert.equal(container.querySelector('#what-native'), native, 'opaque subtree preserved across compat re-render');
  assert.ok(container.textContent.includes('signal:5'));
});

test('compat component works inside a native What tree (bridge)', async () => {
  const { h: whatH, mount: whatMount } = await import('what-core');
  let set;
  function CompatCounter() {
    const [n, s] = useState(0);
    set = s;
    return h('div', { id: 'bridged' }, 'bridge:', n);
  }
  const compatVNode = h(CompatCounter); // vnode.tag is the bridge
  function WhatApp() {
    return whatH('section', {}, compatVNode);
  }
  const container = makeContainer();
  const unmount = whatMount(whatH(WhatApp, {}), container);
  assert.equal(container.querySelector('#bridged').textContent, 'bridge:0');
  act(() => set(3));
  assert.equal(container.querySelector('#bridged').textContent, 'bridge:3');
  unmount();
  assert.equal(container.querySelector('#bridged'), null);
});

// ---------------------------------------------------------------
// Misc API
// ---------------------------------------------------------------

test('Fragment renders children inline', () => {
  const { container } = mount(h('div', null, h(Fragment, null, h('i', null, 'a'), h('i', null, 'b'))));
  assert.equal(container.querySelectorAll('i').length, 2);
});

test('cloneElement merges props and preserves type', () => {
  const el = h('div', { id: 'orig', title: 'a' }, 'child');
  const cloned = React.cloneElement(el, { title: 'b' });
  const { container } = mount(cloned);
  assert.equal(container.firstChild.id, 'orig');
  assert.equal(container.firstChild.title, 'b');
  assert.equal(container.firstChild.textContent, 'child');
});

test('Children.map / count / toArray skip holes', () => {
  const kids = [h('i'), null, false, [h('b'), 'text']];
  assert.equal(React.Children.count(kids), 3);
  assert.equal(React.Children.toArray(kids).length, 3);
  assert.equal(React.Children.map(kids, (c, i) => i).length, 3);
});

test('element.type exposes the original component for library type checks', () => {
  function MyComp() { return null; }
  const el = h(MyComp, { x: 1 });
  assert.equal(el.type, MyComp);
  assert.equal(el.props.x, 1);
});

test('flushSync flushes pending updates synchronously', () => {
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    return h('div', null, n);
  }
  const { container } = mount(h(App));
  flushSync(() => set(42));
  assert.equal(container.textContent, '42');
});
